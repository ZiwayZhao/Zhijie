"""Anthropic Claude client — singleton, structured output, retry, token tracking.

Usage:
    from app.services.llm_client import get_llm_client

    client = get_llm_client()
    result = await client.structured_output(
        model="claude-sonnet-4-5-20250514",
        system="You are...",
        messages=[{"role": "user", "content": "..."}],
        response_schema=MyPydanticModel,
        prompt_version="cart_v1",
    )
    print(result.data)  # MyPydanticModel instance
    print(result.input_tokens, result.output_tokens, result.latency_ms)
"""

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass
from typing import Any, AsyncGenerator, TypeVar

import anthropic
from pydantic import BaseModel

from app.core.config import settings

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

# Singleton
_client: anthropic.AsyncAnthropic | None = None


def get_anthropic_client() -> anthropic.AsyncAnthropic:
    """Lazy singleton AsyncAnthropic client."""
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(
            api_key=settings.anthropic_api_key,
            max_retries=0,  # We handle retries ourselves
        )
    return _client


@dataclass
class LLMResult:
    """Wrapper for LLM call results with audit metadata."""
    data: Any
    input_tokens: int
    output_tokens: int
    latency_ms: int
    model: str
    run_id: str
    prompt_version: str


class LLMError(Exception):
    """Raised when LLM call fails after all retries."""
    pass


class LLMClient:
    """High-level LLM client with retry, structured output, and tracking."""

    def __init__(self):
        self._client = get_anthropic_client()

    async def structured_output(
        self,
        *,
        model: str,
        system: str,
        messages: list[dict],
        response_schema: type[T],
        prompt_version: str,
        max_tokens: int = 4096,
        run_id: str | None = None,
        max_retries: int = 2,
    ) -> LLMResult:
        """Call Claude with Structured Outputs (tool_use mode) → Pydantic model.

        Uses Claude's tool_use feature to guarantee JSON structure,
        then validates with Pydantic as a second layer.

        Args:
            model: Claude model ID.
            system: System prompt.
            messages: Conversation messages.
            response_schema: Pydantic model class for the response.
            prompt_version: Version tag for quality tracking.
            max_tokens: Maximum output tokens.
            run_id: Unique execution ID (auto-generated if None).
            max_retries: Number of retries on transient errors.

        Returns:
            LLMResult with parsed Pydantic model in .data

        Raises:
            LLMError: After all retries exhausted.
        """
        if run_id is None:
            run_id = uuid.uuid4().hex

        # Build tool definition from Pydantic schema
        schema_name = response_schema.__name__
        tool_def = {
            "name": schema_name,
            "description": f"Output structured {schema_name}",
            "input_schema": response_schema.model_json_schema(),
        }

        last_error = None
        for attempt in range(max_retries + 1):
            try:
                start = time.monotonic()
                response = await self._client.messages.create(
                    model=model,
                    system=system,
                    messages=messages,
                    tools=[tool_def],
                    tool_choice={"type": "tool", "name": schema_name},
                    max_tokens=max_tokens,
                )
                elapsed_ms = int((time.monotonic() - start) * 1000)

                # Extract tool_use block
                tool_block = None
                for block in response.content:
                    if block.type == "tool_use" and block.name == schema_name:
                        tool_block = block
                        break

                if tool_block is None:
                    raise LLMError(
                        f"No tool_use block named '{schema_name}' in response"
                    )

                # Pydantic validation (second layer)
                parsed = response_schema.model_validate(tool_block.input)

                return LLMResult(
                    data=parsed,
                    input_tokens=response.usage.input_tokens,
                    output_tokens=response.usage.output_tokens,
                    latency_ms=elapsed_ms,
                    model=model,
                    run_id=run_id,
                    prompt_version=prompt_version,
                )

            except anthropic.RateLimitError:
                wait = 2 ** attempt  # 1s, 2s, 4s
                logger.warning(
                    "Rate limited (attempt %d/%d), waiting %ds",
                    attempt + 1, max_retries + 1, wait,
                )
                await asyncio.sleep(wait)
                last_error = LLMError("Rate limit exceeded after retries")

            except anthropic.APIStatusError as e:
                if e.status_code >= 500 and attempt < max_retries:
                    wait = 2 ** attempt
                    logger.warning(
                        "API error %d (attempt %d/%d), retrying in %ds",
                        e.status_code, attempt + 1, max_retries + 1, wait,
                    )
                    await asyncio.sleep(wait)
                    last_error = LLMError(f"API error {e.status_code}: {e.message}")
                else:
                    raise LLMError(f"API error {e.status_code}: {e.message}") from e

            except anthropic.APIConnectionError as e:
                if attempt < max_retries:
                    wait = 2 ** attempt
                    logger.warning(
                        "Connection error (attempt %d/%d), retrying in %ds",
                        attempt + 1, max_retries + 1, wait,
                    )
                    await asyncio.sleep(wait)
                    last_error = LLMError(f"Connection error: {e}")
                else:
                    raise LLMError(f"Connection error: {e}") from e

        raise last_error or LLMError("Unknown error after retries")

    async def stream_text(
        self,
        *,
        model: str,
        system: str,
        messages: list[dict],
        max_tokens: int = 2048,
    ) -> AsyncGenerator[str, None]:
        """Stream text from Claude (for Socratic dialogue in Sprint 3)."""
        async with self._client.messages.stream(
            model=model,
            system=system,
            messages=messages,
            max_tokens=max_tokens,
        ) as stream:
            async for text in stream.text_stream:
                yield text


# Module-level convenience
_llm_client: LLMClient | None = None


def get_llm_client() -> LLMClient:
    """Return a singleton LLMClient."""
    global _llm_client
    if _llm_client is None:
        _llm_client = LLMClient()
    return _llm_client
