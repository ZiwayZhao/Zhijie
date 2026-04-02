"""Flashcard Consolidation Engine — DreamTask four-phase cycle.

Inspired by Claude Code's DreamTask pattern:
  1. Orient: load deck + FSRS state + evolution indicators
  2. Gather: collect recent ReviewLog data
  3. Consolidate: trigger LLM self-evolution actions
  4. Prune: clean up retired cards, merge duplicates

Three-gate trigger (prevents over-consolidation):
  - Time gate: >= learning_interval since last consolidation
  - Data gate: >= N reviews since last consolidation
  - Lock gate: mutex prevents concurrent consolidation

Mutual exclusion: consolidation pauses while tutor is active.

Usage:
    consolidator = FlashcardConsolidator()
    if consolidator.should_run(deck_state):
        result = await consolidator.run(deck_id, review_logs)
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from app.services.llm_client import get_llm_client, LLMError

logger = logging.getLogger(__name__)

CONSOLIDATE_MODEL = "z-ai/glm-4.7-flash"


# ── Evolution action types ─────────────────────────────────────


class EvolutionAction(str, Enum):
    SPLIT = "split"           # consecutiveAgain >= 3 → split into simpler sub-cards
    RETIRE = "retire"         # consecutiveEasy >= 5 → move out of active rotation
    REWRITE = "rewrite"       # lapse_rate > 50% (reps>10) → rewrite question
    ADD_HINT = "add_hint"     # response_time > 15s → add mnemonic/context
    ADD_PREREQ = "add_prereq" # related cards collectively fail → add prerequisite card


# ── Data structures ────────────────────────────────────────────


@dataclass
class CardEvolutionSignal:
    """A single card flagged for evolution with its detected action."""
    card_id: str
    action: EvolutionAction
    reason: str
    current_front: str
    current_back: str


@dataclass
class ConsolidationResult:
    """Summary of a completed consolidation cycle."""
    deck_id: str
    phase_completed: str  # "orient" | "gather" | "consolidate" | "prune"
    signals_detected: int
    actions_taken: int
    cards_split: int = 0
    cards_retired: int = 0
    cards_rewritten: int = 0
    hints_added: int = 0
    prereqs_added: int = 0
    errors: list[str] = field(default_factory=list)
    duration_ms: int = 0


@dataclass
class DeckState:
    """Snapshot of deck metadata for gate checks."""
    deck_id: str
    total_cards: int
    last_consolidation_at: float  # unix timestamp
    reviews_since_consolidation: int
    tutor_active: bool = False


# ── Three-gate configuration ──────────────────────────────────


MIN_TIME_BETWEEN_CONSOLIDATIONS = 3600   # 1 hour minimum
MIN_REVIEWS_FOR_CONSOLIDATION = 10       # At least 10 reviews
SLOW_RESPONSE_THRESHOLD_MS = 15_000      # 15 seconds
CONSECUTIVE_AGAIN_THRESHOLD = 3
CONSECUTIVE_EASY_THRESHOLD = 5
LAPSE_RATE_THRESHOLD = 0.50              # 50%
MIN_REPS_FOR_LAPSE_RATE = 10


# ── Pydantic schemas for LLM structured output ────────────────


class SplitResult(BaseModel):
    """LLM output when splitting a hard card into simpler sub-cards."""
    sub_cards: list[dict[str, str]] = Field(
        description='2-3张更简单的前置知识卡片，每张 {"front": "...", "back": "..."}',
    )
    rationale: str = Field(
        default="",
        description="拆分理由，说明原卡片为什么难以及子卡片如何构成前置知识",
    )


class RewriteResult(BaseModel):
    """LLM output when rewriting a card's question."""
    new_front: str = Field(description="用不同角度重新表述的问题")
    new_back: str = Field(description="配合新问题调整后的答案")
    rationale: str = Field(default="", description="改写理由")


class HintResult(BaseModel):
    """LLM output when adding a hint to a card."""
    hint: str = Field(description="记忆提示、助记口诀或上下文线索")
    rationale: str = Field(default="", description="为什么这个提示有效")


class PrereqResult(BaseModel):
    """LLM output when generating prerequisite cards."""
    prereq_cards: list[dict[str, str]] = Field(
        description='1-2张前置知识卡片，每张 {"front": "...", "back": "..."}',
    )
    rationale: str = Field(default="", description="缺失的基础概念是什么")


# ── LLM prompts (Chinese) ─────────────────────────────────────


_SPLIT_SYSTEM = """你是一位教学专家。你的任务是将一张太难的闪卡拆分为2-3张更简单的前置知识卡片。

要求：
- 每张子卡片应该只考查一个简单的知识点
- 子卡片应该构成理解原卡片的前置知识链
- 问题和答案都应简洁明了
- 保持与原卡片相同的学科领域"""

_REWRITE_SYSTEM = """你是一位教学专家。你的任务是用不同角度重新表述一张闪卡的问题。

要求：
- 保留核心知识点不变
- 换一个更容易记忆的角度或表述方式
- 可以加入类比、对比或情境化描述
- 答案需要配合新问题做相应调整"""

_ADD_HINT_SYSTEM = """你是一位教学专家。你的任务是为一张闪卡添加记忆提示。

要求：
- 提示应该帮助学生更快地回忆答案
- 可以是助记口诀、联想记忆、首字母缩写或上下文线索
- 提示不应直接泄露答案
- 保持简洁，1-2句话"""

_ADD_PREREQ_SYSTEM = """你是一位教学专家。一组相关闪卡集体表现不佳，说明学生缺失某些基础概念。

要求：
- 识别学生可能缺失的前置知识
- 生成1-2张前置知识卡片来填补这个gap
- 这些卡片应该比原卡片更基础
- 问题和答案都应简洁明了"""


# ── Consolidator engine ────────────────────────────────────────


class FlashcardConsolidator:
    """Four-phase consolidation engine for flashcard self-evolution."""

    # ── Phase 0: Gate check ────────────────────────────────────

    def should_run(self, deck_state: DeckState) -> bool:
        """Three-gate check: lock, time, data.

        Returns True only when all three gates pass.
        """
        # Lock gate: tutor active → skip to avoid interference
        if deck_state.tutor_active:
            logger.debug(
                "Consolidation skipped for deck %s: tutor active",
                deck_state.deck_id,
            )
            return False

        # Time gate: must wait at least MIN_TIME_BETWEEN_CONSOLIDATIONS
        elapsed = time.time() - deck_state.last_consolidation_at
        if elapsed < MIN_TIME_BETWEEN_CONSOLIDATIONS:
            logger.debug(
                "Consolidation skipped for deck %s: only %ds elapsed (need %ds)",
                deck_state.deck_id,
                int(elapsed),
                MIN_TIME_BETWEEN_CONSOLIDATIONS,
            )
            return False

        # Data gate: must have enough new reviews
        if deck_state.reviews_since_consolidation < MIN_REVIEWS_FOR_CONSOLIDATION:
            logger.debug(
                "Consolidation skipped for deck %s: only %d reviews (need %d)",
                deck_state.deck_id,
                deck_state.reviews_since_consolidation,
                MIN_REVIEWS_FOR_CONSOLIDATION,
            )
            return False

        return True

    # ── Phase 1+2: Orient + Gather → detect signals ───────────

    def detect_evolution_signals(
        self, cards: list[dict],
    ) -> list[CardEvolutionSignal]:
        """Scan cards for evolution triggers.

        Each card dict should contain:
            card_id, front, back,
            consecutive_again, consecutive_easy,
            reps, lapses, avg_response_ms

        Returns list of CardEvolutionSignal, one per triggered card.
        Multiple actions on the same card are prioritized (only the
        highest-priority action is kept).
        """
        signals: list[CardEvolutionSignal] = []

        for card in cards:
            card_id = card.get("card_id", "")
            front = card.get("front", "")
            back = card.get("back", "")
            consecutive_again = card.get("consecutive_again", 0)
            consecutive_easy = card.get("consecutive_easy", 0)
            reps = card.get("reps", 0)
            lapses = card.get("lapses", 0)
            avg_response_ms = card.get("avg_response_ms")

            # Priority order: SPLIT > REWRITE > ADD_HINT > RETIRE
            # Only emit the highest-priority signal per card.

            # 1. SPLIT: consecutive failures indicate the card is too hard
            if consecutive_again >= CONSECUTIVE_AGAIN_THRESHOLD:
                signals.append(CardEvolutionSignal(
                    card_id=card_id,
                    action=EvolutionAction.SPLIT,
                    reason=(
                        f"连续{consecutive_again}次答错，"
                        f"卡片可能过于复杂需要拆分"
                    ),
                    current_front=front,
                    current_back=back,
                ))
                continue

            # 2. REWRITE: high lapse rate with enough data
            if reps >= MIN_REPS_FOR_LAPSE_RATE:
                lapse_rate = lapses / reps
                if lapse_rate > LAPSE_RATE_THRESHOLD:
                    signals.append(CardEvolutionSignal(
                        card_id=card_id,
                        action=EvolutionAction.REWRITE,
                        reason=(
                            f"遗忘率{lapse_rate:.0%}（{lapses}/{reps}次），"
                            f"问法可能不利于记忆"
                        ),
                        current_front=front,
                        current_back=back,
                    ))
                    continue

            # 3. ADD_HINT: slow response time
            if (
                avg_response_ms is not None
                and avg_response_ms > SLOW_RESPONSE_THRESHOLD_MS
            ):
                signals.append(CardEvolutionSignal(
                    card_id=card_id,
                    action=EvolutionAction.ADD_HINT,
                    reason=(
                        f"平均回答时间{avg_response_ms / 1000:.1f}秒，"
                        f"超过{SLOW_RESPONSE_THRESHOLD_MS / 1000:.0f}秒阈值"
                    ),
                    current_front=front,
                    current_back=back,
                ))
                continue

            # 4. RETIRE: consistently easy → move out of rotation
            if consecutive_easy >= CONSECUTIVE_EASY_THRESHOLD:
                signals.append(CardEvolutionSignal(
                    card_id=card_id,
                    action=EvolutionAction.RETIRE,
                    reason=(
                        f"连续{consecutive_easy}次轻松答对，"
                        f"已充分掌握可以退役"
                    ),
                    current_front=front,
                    current_back=back,
                ))
                continue

        return signals

    def detect_collective_failure(
        self, cards: list[dict], tag: str,
    ) -> CardEvolutionSignal | None:
        """Detect if cards sharing a tag collectively fail.

        Used for ADD_PREREQ: when multiple related cards all have
        high lapse rates, it suggests a missing prerequisite concept.

        Args:
            cards: All cards (same format as detect_evolution_signals).
            tag: The tag to filter by (e.g. module name).

        Returns:
            A single ADD_PREREQ signal if collective failure detected,
            None otherwise.
        """
        tagged = [
            c for c in cards
            if tag in c.get("tags", [])
        ]
        if len(tagged) < 2:
            return None

        failing = [
            c for c in tagged
            if c.get("reps", 0) >= 3
            and c.get("lapses", 0) / max(c.get("reps", 1), 1) > 0.4
        ]

        # Majority failing → collective failure
        if len(failing) >= len(tagged) * 0.5:
            # Use the worst-performing card as representative
            worst = max(
                failing,
                key=lambda c: c.get("lapses", 0) / max(c.get("reps", 1), 1),
            )
            return CardEvolutionSignal(
                card_id=worst.get("card_id", ""),
                action=EvolutionAction.ADD_PREREQ,
                reason=(
                    f"标签'{tag}'下{len(failing)}/{len(tagged)}张卡片"
                    f"集体表现不佳，可能缺失前置知识"
                ),
                current_front=worst.get("front", ""),
                current_back=worst.get("back", ""),
            )

        return None

    # ── Phase 3: Consolidate → LLM evolution ──────────────────

    async def execute_evolution(
        self, signal: CardEvolutionSignal,
    ) -> dict[str, Any]:
        """Use LLM to generate evolved card content for a single signal.

        Returns a dict with action-specific keys:
            SPLIT:      {"sub_cards": [{"front": ..., "back": ...}, ...]}
            RETIRE:     {"retired": True}
            REWRITE:    {"new_front": ..., "new_back": ...}
            ADD_HINT:   {"hint": ...}
            ADD_PREREQ: {"prereq_cards": [{"front": ..., "back": ...}, ...]}

        On LLM failure, returns {"error": "..."}.
        """
        # RETIRE needs no LLM call
        if signal.action == EvolutionAction.RETIRE:
            logger.info(
                "Retiring card %s: %s", signal.card_id, signal.reason,
            )
            return {"retired": True, "reason": signal.reason}

        card_context = (
            f"问题：{signal.current_front}\n"
            f"答案：{signal.current_back}\n"
            f"原因：{signal.reason}"
        )

        llm = get_llm_client()

        try:
            if signal.action == EvolutionAction.SPLIT:
                result = await llm.structured_output(
                    model=CONSOLIDATE_MODEL,
                    system=_SPLIT_SYSTEM,
                    messages=[{
                        "role": "user",
                        "content": (
                            "这张闪卡太难了，学生连续3次答错。"
                            "请将其拆分为2-3张更简单的前置知识卡片。\n\n"
                            f"{card_context}"
                        ),
                    }],
                    response_schema=SplitResult,
                    prompt_version="flashcard_split_v1",
                    max_tokens=1024,
                    max_retries=2,
                )
                parsed: SplitResult = result.data
                return {
                    "sub_cards": parsed.sub_cards,
                    "rationale": parsed.rationale,
                }

            elif signal.action == EvolutionAction.REWRITE:
                result = await llm.structured_output(
                    model=CONSOLIDATE_MODEL,
                    system=_REWRITE_SYSTEM,
                    messages=[{
                        "role": "user",
                        "content": (
                            "这张闪卡的问法让学生反复记不住。"
                            "请用不同的角度重新表述问题。\n\n"
                            f"{card_context}"
                        ),
                    }],
                    response_schema=RewriteResult,
                    prompt_version="flashcard_rewrite_v1",
                    max_tokens=512,
                    max_retries=2,
                )
                parsed_rw: RewriteResult = result.data
                return {
                    "new_front": parsed_rw.new_front,
                    "new_back": parsed_rw.new_back,
                    "rationale": parsed_rw.rationale,
                }

            elif signal.action == EvolutionAction.ADD_HINT:
                result = await llm.structured_output(
                    model=CONSOLIDATE_MODEL,
                    system=_ADD_HINT_SYSTEM,
                    messages=[{
                        "role": "user",
                        "content": (
                            "学生回答这道题很慢（>15秒）。"
                            "请为其添加一个记忆提示或助记口诀。\n\n"
                            f"{card_context}"
                        ),
                    }],
                    response_schema=HintResult,
                    prompt_version="flashcard_hint_v1",
                    max_tokens=512,
                    max_retries=2,
                )
                parsed_hint: HintResult = result.data
                return {
                    "hint": parsed_hint.hint,
                    "rationale": parsed_hint.rationale,
                }

            elif signal.action == EvolutionAction.ADD_PREREQ:
                result = await llm.structured_output(
                    model=CONSOLIDATE_MODEL,
                    system=_ADD_PREREQ_SYSTEM,
                    messages=[{
                        "role": "user",
                        "content": (
                            "一组相关闪卡集体表现不佳，学生可能缺失基础概念。"
                            "请生成1-2张前置知识卡片。\n\n"
                            f"{card_context}"
                        ),
                    }],
                    response_schema=PrereqResult,
                    prompt_version="flashcard_prereq_v1",
                    max_tokens=1024,
                    max_retries=2,
                )
                parsed_prereq: PrereqResult = result.data
                return {
                    "prereq_cards": parsed_prereq.prereq_cards,
                    "rationale": parsed_prereq.rationale,
                }

        except (LLMError, Exception) as exc:
            logger.warning(
                "Evolution LLM call failed for card %s (%s): %s",
                signal.card_id,
                signal.action.value,
                exc,
            )
            return {"error": str(exc)}

        return {"error": f"Unknown action: {signal.action}"}

    # ── Phase 4: Prune ─────────────────────────────────────────

    @staticmethod
    def identify_duplicates(cards: list[dict]) -> list[tuple[str, str]]:
        """Find near-duplicate cards by comparing fronts.

        Returns pairs of (card_id_a, card_id_b) that are likely duplicates.
        Uses simple normalized string comparison — good enough for
        flashcard text which is typically short.
        """
        duplicates: list[tuple[str, str]] = []
        normalized: list[tuple[str, str]] = []  # (card_id, normalized_front)

        for card in cards:
            card_id = card.get("card_id", "")
            front = card.get("front", "").strip().lower()
            # Remove common punctuation for comparison
            clean = front.replace("？", "").replace("?", "").replace(".", "")
            clean = clean.replace("，", "").replace(",", "").strip()
            normalized.append((card_id, clean))

        # O(n^2) but deck sizes are small (typically < 500 cards)
        seen: set[str] = set()
        for i, (id_a, front_a) in enumerate(normalized):
            if id_a in seen or not front_a:
                continue
            for j in range(i + 1, len(normalized)):
                id_b, front_b = normalized[j]
                if id_b in seen or not front_b:
                    continue
                # Exact match after normalization
                if front_a == front_b:
                    duplicates.append((id_a, id_b))
                    seen.add(id_b)

        return duplicates

    # ── Full cycle ─────────────────────────────────────────────

    async def run(
        self,
        deck_id: str,
        cards: list[dict],
        tags: list[str] | None = None,
    ) -> ConsolidationResult:
        """Run full four-phase consolidation cycle.

        Args:
            deck_id: Deck identifier.
            cards: Card dicts with fields: card_id, front, back,
                   consecutive_again, consecutive_easy, reps, lapses,
                   avg_response_ms, tags.
            tags: Optional list of tags to check for collective failure.
                  If None, collective failure detection is skipped.

        Returns:
            ConsolidationResult with summary of all actions taken.
        """
        start_time = time.monotonic()

        result = ConsolidationResult(
            deck_id=deck_id,
            phase_completed="orient",
            signals_detected=0,
            actions_taken=0,
        )

        # ── Phase 1: Orient ────────────────────────────────────
        logger.info(
            "Consolidation started for deck %s (%d cards)",
            deck_id,
            len(cards),
        )

        if not cards:
            result.phase_completed = "prune"
            result.duration_ms = int(
                (time.monotonic() - start_time) * 1000,
            )
            return result

        # ── Phase 2: Gather + detect signals ───────────────────
        signals = self.detect_evolution_signals(cards)

        # Check collective failure for each tag
        if tags:
            for tag in tags:
                prereq_signal = self.detect_collective_failure(cards, tag)
                if prereq_signal is not None:
                    # Avoid duplicate if the card already has a signal
                    existing_ids = {s.card_id for s in signals}
                    if prereq_signal.card_id not in existing_ids:
                        signals.append(prereq_signal)

        result.signals_detected = len(signals)
        result.phase_completed = "gather"

        logger.info(
            "Deck %s: detected %d evolution signals",
            deck_id,
            len(signals),
        )

        if not signals:
            result.phase_completed = "prune"
            result.duration_ms = int(
                (time.monotonic() - start_time) * 1000,
            )
            return result

        # ── Phase 3: Consolidate — execute LLM evolution ───────
        for signal in signals:
            logger.info(
                "Executing %s on card %s: %s",
                signal.action.value,
                signal.card_id,
                signal.reason,
            )
            evolution_output = await self.execute_evolution(signal)

            if "error" in evolution_output:
                result.errors.append(
                    f"{signal.card_id}/{signal.action.value}: "
                    f"{evolution_output['error']}"
                )
                continue

            result.actions_taken += 1

            if signal.action == EvolutionAction.SPLIT:
                sub_cards = evolution_output.get("sub_cards", [])
                result.cards_split += len(sub_cards)
            elif signal.action == EvolutionAction.RETIRE:
                result.cards_retired += 1
            elif signal.action == EvolutionAction.REWRITE:
                result.cards_rewritten += 1
            elif signal.action == EvolutionAction.ADD_HINT:
                result.hints_added += 1
            elif signal.action == EvolutionAction.ADD_PREREQ:
                prereq_cards = evolution_output.get("prereq_cards", [])
                result.prereqs_added += len(prereq_cards)

        result.phase_completed = "consolidate"

        # ── Phase 4: Prune — identify duplicates ───────────────
        duplicates = self.identify_duplicates(cards)
        if duplicates:
            logger.info(
                "Deck %s: found %d duplicate pairs for review",
                deck_id,
                len(duplicates),
            )

        result.phase_completed = "prune"
        result.duration_ms = int(
            (time.monotonic() - start_time) * 1000,
        )

        logger.info(
            "Consolidation complete for deck %s: "
            "%d signals, %d actions, %d errors, %dms",
            deck_id,
            result.signals_detected,
            result.actions_taken,
            len(result.errors),
            result.duration_ms,
        )

        return result


# ── Serialization helpers ──────────────────────────────────────


def result_to_dict(result: ConsolidationResult) -> dict:
    """Serialize ConsolidationResult for JSON storage or API response."""
    return {
        "deck_id": result.deck_id,
        "phase_completed": result.phase_completed,
        "signals_detected": result.signals_detected,
        "actions_taken": result.actions_taken,
        "cards_split": result.cards_split,
        "cards_retired": result.cards_retired,
        "cards_rewritten": result.cards_rewritten,
        "hints_added": result.hints_added,
        "prereqs_added": result.prereqs_added,
        "errors": result.errors,
        "duration_ms": result.duration_ms,
    }
