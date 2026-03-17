"""OpenRouter LLM client — singleton, structured output (function calling), retry, token tracking.

Usage:
    from app.services.llm_client import get_llm_client

    client = get_llm_client()
    result = await client.structured_output(
        model="anthropic/claude-sonnet-4.5",
        system="You are...",
        messages=[{"role": "user", "content": "..."}],
        response_schema=MyPydanticModel,
        prompt_version="cart_v1",
    )
    print(result.data)  # MyPydanticModel instance
    print(result.input_tokens, result.output_tokens, result.latency_ms)
"""

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass
from typing import Any, AsyncGenerator, TypeVar

from openai import AsyncOpenAI, APIConnectionError, APIStatusError, RateLimitError
from pydantic import BaseModel

from app.core.config import settings

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


def _resolve_refs(schema: dict) -> dict:
    """Inline $defs/$ref so the schema is self-contained (OpenRouter compat)."""
    defs = schema.pop("$defs", {})
    if not defs:
        return schema

    def _resolve(node):
        if isinstance(node, dict):
            if "$ref" in node:
                ref_path = node["$ref"]  # e.g. "#/$defs/SelfTestQuestion"
                ref_name = ref_path.rsplit("/", 1)[-1]
                if ref_name in defs:
                    return _resolve(defs[ref_name].copy())
                return node
            return {k: _resolve(v) for k, v in node.items()}
        if isinstance(node, list):
            return [_resolve(item) for item in node]
        return node

    return _resolve(schema)

# Singleton
_client: AsyncOpenAI | None = None


def get_openai_client() -> AsyncOpenAI:
    """Lazy singleton AsyncOpenAI client configured for OpenRouter."""
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            api_key=settings.openrouter_api_key,
            base_url="https://openrouter.ai/api/v1",
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
        self._client = get_openai_client()

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
        """Call LLM with function calling → Pydantic model.

        Uses OpenAI-compatible function calling to get structured JSON,
        then validates with Pydantic as a second layer.

        Args:
            model: Model ID (OpenRouter format, e.g. "anthropic/claude-sonnet-4.5").
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

        # Build function definition from Pydantic schema
        schema_name = response_schema.__name__
        raw_schema = response_schema.model_json_schema()
        resolved = _resolve_refs(raw_schema)
        # Remove unsupported keys for OpenRouter
        resolved.pop("title", None)
        resolved.pop("description", None)
        func_def = {
            "type": "function",
            "function": {
                "name": schema_name,
                "description": f"Output structured {schema_name}",
                "parameters": resolved,
            },
        }
        logger.debug("Tool schema for %s: %s", schema_name, json.dumps(resolved, ensure_ascii=False)[:500])

        # Build messages with system prompt
        full_messages = [{"role": "system", "content": system}] + messages

        last_error = None
        for attempt in range(max_retries + 1):
            try:
                start = time.monotonic()
                response = await self._client.chat.completions.create(
                    model=model,
                    messages=full_messages,
                    tools=[func_def],
                    tool_choice={"type": "function", "function": {"name": schema_name}},
                    max_tokens=max_tokens,
                )
                elapsed_ms = int((time.monotonic() - start) * 1000)

                # Extract function call from response
                choice = response.choices[0]
                logger.info(
                    "LLM response: finish_reason=%s, tool_calls=%d, content=%s",
                    choice.finish_reason,
                    len(choice.message.tool_calls or []),
                    (choice.message.content or "")[:200],
                )
                tool_call = None
                if choice.message.tool_calls:
                    for tc in choice.message.tool_calls:
                        logger.info(
                            "Tool call: name=%s, args_len=%d, args_preview=%s",
                            tc.function.name,
                            len(tc.function.arguments),
                            tc.function.arguments[:300],
                        )
                        if tc.function.name == schema_name:
                            tool_call = tc
                            break

                if tool_call is None:
                    raise LLMError(
                        f"No function call named '{schema_name}' in response"
                    )

                # Parse JSON arguments
                raw_args = json.loads(tool_call.function.arguments)
                logger.info("Parsed args keys: %s", list(raw_args.keys()))

                # Pydantic validation (second layer)
                parsed = response_schema.model_validate(raw_args)

                usage = response.usage or type("Usage", (), {"prompt_tokens": 0, "completion_tokens": 0})()
                return LLMResult(
                    data=parsed,
                    input_tokens=getattr(usage, "prompt_tokens", 0),
                    output_tokens=getattr(usage, "completion_tokens", 0),
                    latency_ms=elapsed_ms,
                    model=model,
                    run_id=run_id,
                    prompt_version=prompt_version,
                )

            except RateLimitError:
                wait = 2 ** attempt  # 1s, 2s, 4s
                logger.warning(
                    "Rate limited (attempt %d/%d), waiting %ds",
                    attempt + 1, max_retries + 1, wait,
                )
                await asyncio.sleep(wait)
                last_error = LLMError("Rate limit exceeded after retries")

            except APIStatusError as e:
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

            except APIConnectionError as e:
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
        """Stream text from LLM (for Socratic dialogue)."""
        full_messages = [{"role": "system", "content": system}] + messages
        stream = await self._client.chat.completions.create(
            model=model,
            messages=full_messages,
            max_tokens=max_tokens,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                yield delta.content


# Module-level convenience
_llm_client: LLMClient | None = None


def get_llm_client() -> LLMClient:
    """Return a singleton LLMClient."""
    global _llm_client
    if _llm_client is None:
        _llm_client = LLMClient()
    return _llm_client
