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


def _fix_double_serialized(data: dict) -> dict:
    """Fix fields where OpenRouter returns JSON strings instead of objects/arrays.

    Example: {"self_test_questions": "[{\"question\": ...}]"} should be
             {"self_test_questions": [{"question": ...}]}
    """
    fixed = {}
    for key, value in data.items():
        if isinstance(value, str) and value.strip().startswith(("[", "{")):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, (list, dict)):
                    logger.info("Fixed double-serialized field: %s", key)
                    fixed[key] = parsed
                    continue
            except (json.JSONDecodeError, ValueError):
                pass
        fixed[key] = value
    return fixed

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
    """Lazy singleton AsyncOpenAI client — uses LLM_BASE_URL if set, else OpenRouter."""
    global _client
    if _client is None:
        if settings.llm_base_url and settings.llm_api_key:
            api_key = settings.llm_api_key
            base_url = settings.llm_base_url
            logger.info("Using custom LLM endpoint: %s", base_url)
        else:
            api_key = settings.openrouter_api_key
            base_url = "https://openrouter.ai/api/v1"
            logger.info("Using OpenRouter endpoint")
        _client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
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

    def __init__(self, *, custom_base_url: str | None = None, custom_api_key: str | None = None):
        if custom_base_url and custom_api_key:
            # Per-user custom LLM endpoint — NOT the singleton
            self._client = AsyncOpenAI(
                api_key=custom_api_key,
                base_url=custom_base_url,
                max_retries=0,
            )
            self._is_custom = True
            self._custom_base_url = custom_base_url
            logger.info("LLMClient using custom endpoint: %s", custom_base_url)
        else:
            self._client = get_openai_client()
            self._is_custom = False
            self._custom_base_url = settings.llm_base_url

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
        max_retries: int = 3,
    ) -> LLMResult:
        """Call LLM with function calling → Pydantic model.

        Strategy: try function calling first; if model doesn't support
        tool_choice (404), automatically fall back to JSON-in-prompt mode.

        Args:
            model: Model ID (OpenRouter format).
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

        try:
            return await self._structured_output_function_calling(
                model=model, system=system, messages=messages,
                response_schema=response_schema, prompt_version=prompt_version,
                max_tokens=max_tokens, run_id=run_id, max_retries=max_retries,
            )
        except LLMError as e:
            err_str = str(e).lower()
            # Fallback to JSON prompt mode when function calling isn't working:
            # - 404 + tool_choice: provider doesn't support tool_choice param
            # - "no function call named": model returned text instead of tool_call
            should_fallback = (
                ("404" in err_str and "tool_choice" in err_str)
                or "no function call named" in err_str
            )
            if should_fallback:
                logger.info(
                    "Model %s function calling failed (%s), falling back to JSON prompt mode",
                    model, str(e)[:100],
                )
                return await self._structured_output_json_prompt(
                    model=model, system=system, messages=messages,
                    response_schema=response_schema, prompt_version=prompt_version,
                    max_tokens=max_tokens, run_id=run_id, max_retries=max_retries,
                )
            raise

    async def _structured_output_json_prompt(
        self,
        *,
        model: str,
        system: str,
        messages: list[dict],
        response_schema: type[T],
        prompt_version: str,
        max_tokens: int = 4096,
        run_id: str,
        max_retries: int = 3,
    ) -> LLMResult:
        """Fallback: instruct LLM to return JSON matching schema in the text response."""
        from pydantic import ValidationError

        schema_name = response_schema.__name__
        raw_schema = response_schema.model_json_schema()
        resolved = _resolve_refs(raw_schema)
        resolved.pop("title", None)
        resolved.pop("description", None)
        schema_str = json.dumps(resolved, ensure_ascii=False, indent=2)

        json_system = (
            f"{system}\n\n"
            f"你必须以纯 JSON 格式回复，严格符合以下 JSON Schema：\n"
            f"```json\n{schema_str}\n```\n"
            f"不要输出任何其他内容，只输出一个合法的 JSON 对象。不要用 markdown 代码块包裹。"
        )

        last_error = None
        for attempt in range(max_retries + 1):
            try:
                start = time.monotonic()
                full_msgs = [{"role": "system", "content": json_system}] + messages
                response = await self._client.chat.completions.create(
                    model=model,
                    messages=full_msgs,
                    max_tokens=max_tokens,
                )
                elapsed_ms = int((time.monotonic() - start) * 1000)

                if not response.choices:
                    raise LLMError("LLM returned empty choices")

                content = response.choices[0].message.content or ""
                logger.info("JSON prompt response preview: %s", content[:300])

                # Strip markdown code fences if present
                text = content.strip()
                if text.startswith("```"):
                    # Remove first line (```json) and last line (```)
                    lines = text.split("\n")
                    lines = [l for l in lines if not l.strip().startswith("```")]
                    text = "\n".join(lines)

                raw_args = json.loads(text)
                raw_args = _fix_double_serialized(raw_args)
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

            except (ValidationError, json.JSONDecodeError) as e:
                if attempt < max_retries:
                    logger.warning(
                        "JSON prompt validation failed (attempt %d/%d): %s",
                        attempt + 1, max_retries + 1, str(e)[:300],
                    )
                    last_error = LLMError(f"Validation error: {e}")
                    await asyncio.sleep(1)
                    continue
                raise LLMError(f"JSON prompt validation failed after retries: {e}") from e

            except RateLimitError:
                wait = 2 ** attempt
                logger.warning("Rate limited (attempt %d/%d), waiting %ds", attempt + 1, max_retries + 1, wait)
                await asyncio.sleep(wait)
                last_error = LLMError("Rate limit exceeded")

            except APIStatusError as e:
                if e.status_code >= 500 and attempt < max_retries:
                    wait = 2 ** attempt
                    await asyncio.sleep(wait)
                    last_error = LLMError(f"API error {e.status_code}: {e.message}")
                else:
                    raise LLMError(f"API error {e.status_code}: {e.message}") from e

            except APIConnectionError as e:
                if attempt < max_retries:
                    await asyncio.sleep(2 ** attempt)
                    last_error = LLMError(f"Connection error: {e}")
                else:
                    raise LLMError(f"Connection error: {e}") from e

        raise last_error or LLMError("Unknown error after retries")

    async def _structured_output_function_calling(
        self,
        *,
        model: str,
        system: str,
        messages: list[dict],
        response_schema: type[T],
        prompt_version: str,
        max_tokens: int = 4096,
        run_id: str,
        max_retries: int = 3,
    ) -> LLMResult:
        """Primary path: use OpenAI-compatible function calling with tool_choice."""
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

        from pydantic import ValidationError

        last_error = None
        retry_messages = list(messages)  # Mutable copy for validation retries

        for attempt in range(max_retries + 1):
            try:
                start = time.monotonic()
                full_msgs = [{"role": "system", "content": system}] + retry_messages
                # Some providers (e.g. Tencent CodingPlan) reject tool_choice
                create_kwargs: dict = dict(
                    model=model,
                    messages=full_msgs,
                    tools=[func_def],
                    max_tokens=max_tokens,
                )
                base_url = self._custom_base_url or settings.llm_base_url or ""
                if not base_url or "openrouter" in base_url:
                    create_kwargs["tool_choice"] = {
                        "type": "function",
                        "function": {"name": schema_name},
                    }
                response = await self._client.chat.completions.create(**create_kwargs)
                elapsed_ms = int((time.monotonic() - start) * 1000)

                # Extract function call from response
                if not response.choices:
                    raise LLMError(
                        "LLM returned empty choices (model may be overloaded)"
                    )
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

                # Fix double-serialized fields (OpenRouter sometimes returns
                # nested objects as JSON strings instead of actual objects/arrays)
                raw_args = _fix_double_serialized(raw_args)

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

            except (ValidationError, json.JSONDecodeError) as e:
                # Schema validation failed — retry with error feedback
                if attempt < max_retries:
                    logger.warning(
                        "Schema validation failed (attempt %d/%d): %s. Retrying with error feedback...",
                        attempt + 1, max_retries + 1, str(e)[:300],
                    )
                    error_feedback = (
                        f"Your previous response had a schema validation error: {str(e)[:500]}. "
                        f"Please fix the issue and return a valid {schema_name} with ALL required fields. "
                        f"Make sure every required field is present and has the correct type."
                    )
                    retry_messages = retry_messages + [
                        {"role": "assistant", "content": f"I'll call the {schema_name} function."},
                        {"role": "user", "content": error_feedback},
                    ]
                    last_error = LLMError(f"Validation error: {e}")
                    await asyncio.sleep(1)
                    continue
                raise LLMError(f"Validation failed after retries: {e}") from e

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
        max_retries: int = 2,
        fallback_model: str | None = None,
    ) -> AsyncGenerator[str, None]:
        """Stream text from LLM with retry and model fallback.

        Retry strategy (inspired by Claude Code's withRetry):
        - RateLimitError: exponential backoff, respect retry-after header
        - APIStatusError (5xx): exponential backoff
        - APIConnectionError: exponential backoff
        - On final failure with fallback_model: try once with cheaper model

        Args:
            model: Primary model ID.
            system: System prompt.
            messages: Conversation messages.
            max_tokens: Max output tokens.
            max_retries: Retry attempts for transient errors.
            fallback_model: If primary model fails, try this model once.

        Yields:
            Text tokens as they arrive.

        Raises:
            LLMError: After all retries and fallback exhausted.
        """
        full_messages = [{"role": "system", "content": system}] + messages

        current_model = model
        last_error: Exception | None = None

        for attempt in range(max_retries + 1):
            try:
                stream = await self._client.chat.completions.create(
                    model=current_model,
                    messages=full_messages,
                    max_tokens=max_tokens,
                    stream=True,
                )
                async for chunk in stream:
                    delta = chunk.choices[0].delta if chunk.choices else None
                    if delta and delta.content:
                        yield delta.content
                return  # Success — exit

            except RateLimitError as e:
                # Respect retry-after header if present
                retry_after = None
                if hasattr(e, 'response') and e.response is not None:
                    retry_header = e.response.headers.get('retry-after')
                    if retry_header:
                        try:
                            retry_after = int(retry_header)
                        except ValueError:
                            pass

                wait = retry_after if retry_after else (2 ** attempt)
                logger.warning(
                    "stream_text rate limited (attempt %d/%d), waiting %ds",
                    attempt + 1, max_retries + 1, wait,
                )
                last_error = e
                if attempt < max_retries:
                    await asyncio.sleep(wait)
                    continue

            except APIStatusError as e:
                if e.status_code >= 500 and attempt < max_retries:
                    wait = 2 ** attempt
                    logger.warning(
                        "stream_text API error %d (attempt %d/%d), retrying in %ds",
                        e.status_code, attempt + 1, max_retries + 1, wait,
                    )
                    last_error = e
                    await asyncio.sleep(wait)
                    continue
                last_error = e
                break

            except APIConnectionError as e:
                if attempt < max_retries:
                    wait = 2 ** attempt
                    logger.warning(
                        "stream_text connection error (attempt %d/%d), retrying in %ds",
                        attempt + 1, max_retries + 1, wait,
                    )
                    last_error = e
                    await asyncio.sleep(wait)
                    continue
                last_error = e
                break

        # All retries exhausted — try fallback model if configured
        if fallback_model and fallback_model != current_model:
            logger.warning(
                "stream_text: primary model %s failed, falling back to %s",
                model, fallback_model,
            )
            try:
                stream = await self._client.chat.completions.create(
                    model=fallback_model,
                    messages=full_messages,
                    max_tokens=max_tokens,
                    stream=True,
                )
                async for chunk in stream:
                    delta = chunk.choices[0].delta if chunk.choices else None
                    if delta and delta.content:
                        yield delta.content
                return  # Fallback success
            except Exception as fallback_err:
                logger.error(
                    "stream_text: fallback model %s also failed: %s",
                    fallback_model, fallback_err,
                )

        raise LLMError(
            f"stream_text failed after {max_retries + 1} attempts: {last_error}"
        )

    async def non_streaming_chat(
        self,
        *,
        model: str,
        system: str,
        messages: list[dict],
        max_tokens: int = 1024,
        max_retries: int = 2,
    ) -> str:
        """Non-streaming text completion. Used for intermediate synthesis.

        Simpler than structured_output (no function schema) and stream_text
        (no streaming). Returns the full text at once.

        Args:
            model: Model ID.
            system: System prompt.
            messages: Conversation messages.
            max_tokens: Max output tokens.
            max_retries: Retry attempts for transient errors.

        Returns:
            Complete text response.

        Raises:
            LLMError: After all retries exhausted.
        """
        full_messages = [{"role": "system", "content": system}] + messages
        last_error: Exception | None = None

        for attempt in range(max_retries + 1):
            try:
                response = await self._client.chat.completions.create(
                    model=model,
                    messages=full_messages,
                    max_tokens=max_tokens,
                )
                if not response.choices:
                    raise LLMError("Empty response from LLM")

                content = response.choices[0].message.content or ""
                return content

            except RateLimitError as e:
                wait = 2 ** attempt
                logger.warning(
                    "non_streaming_chat rate limited (attempt %d/%d), waiting %ds",
                    attempt + 1, max_retries + 1, wait,
                )
                last_error = e
                if attempt < max_retries:
                    await asyncio.sleep(wait)
                    continue

            except APIStatusError as e:
                if e.status_code >= 500 and attempt < max_retries:
                    wait = 2 ** attempt
                    logger.warning(
                        "non_streaming_chat API error %d (attempt %d/%d), retrying",
                        e.status_code, attempt + 1, max_retries + 1,
                    )
                    last_error = e
                    await asyncio.sleep(wait)
                    continue
                raise LLMError(f"API error {e.status_code}: {e.message}") from e

            except APIConnectionError as e:
                if attempt < max_retries:
                    wait = 2 ** attempt
                    logger.warning(
                        "non_streaming_chat connection error (attempt %d/%d)",
                        attempt + 1, max_retries + 1,
                    )
                    last_error = e
                    await asyncio.sleep(wait)
                    continue
                raise LLMError(f"Connection error: {e}") from e

        raise LLMError(
            f"non_streaming_chat failed after {max_retries + 1} attempts: {last_error}"
        )


# Module-level convenience
_llm_client: LLMClient | None = None


def get_llm_client() -> LLMClient:
    """Return a singleton LLMClient."""
    global _llm_client
    if _llm_client is None:
        _llm_client = LLMClient()
    return _llm_client


async def get_llm_client_for_user(user_id) -> tuple[LLMClient, str | None]:
    """Return an LLMClient configured with the user's custom API key if set.

    Returns (client, preferred_model) tuple.
    If user has no custom settings, returns the system singleton + None.
    """
    from sqlalchemy import select
    from app.db.session import async_session_factory
    from app.models.user_llm_settings import UserLLMSettings
    from app.core.encryption import decrypt_api_key

    async with async_session_factory() as session:
        result = await session.execute(
            select(UserLLMSettings).where(UserLLMSettings.user_id == user_id)
        )
        user_settings = result.scalar_one_or_none()

    if not user_settings or user_settings.llm_provider == "system":
        return get_llm_client(), None

    if not user_settings.llm_api_key_encrypted:
        return get_llm_client(), user_settings.llm_model

    try:
        api_key = decrypt_api_key(user_settings.llm_api_key_encrypted)
    except Exception:
        logger.warning("Failed to decrypt API key for user %s, using system default", user_id)
        return get_llm_client(), None

    base_url = user_settings.llm_base_url
    if not base_url:
        # Shouldn't happen if provider preset was applied, but fallback
        return get_llm_client(), user_settings.llm_model

    return LLMClient(custom_base_url=base_url, custom_api_key=api_key), user_settings.llm_model
