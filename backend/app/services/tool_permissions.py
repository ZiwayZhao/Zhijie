"""Tool Permission System — Allow/Ask/Deny three-state model.

Inspired by CC's permission architecture:
- Allow: tool runs silently (read-only tools like get_specialist, get_quiz)
- Ask: tool requires user confirmation before execution (write tools)
- Deny: tool is blocked for AI (safety-critical operations)

The default permission map classifies all known tools. Unknown tools
default to ASK (fail-safe: require confirmation for anything unregistered).

Per-session overrides let the frontend grant blanket permission for
specific tools (e.g. user clicks "always allow flashcard generation").

Usage:
    perms = ToolPermissions()
    state = perms.check("get_specialist")  # → PermissionState.ALLOW
    state = perms.check("update_mastery")  # → PermissionState.ASK

    # User grants override for the session
    perms.set_override("generate_flashcards", PermissionState.ALLOW)
    state = perms.check("generate_flashcards")  # → PermissionState.ALLOW
"""

from __future__ import annotations

import logging
from enum import Enum

logger = logging.getLogger(__name__)


class PermissionState(str, Enum):
    """Three-state permission model for tool execution."""

    ALLOW = "allow"  # Silent execution, no user prompt
    ASK = "ask"  # Needs user confirmation before running
    DENY = "deny"  # Blocked — AI cannot invoke this tool


# ── Default Permission Map ─────────────────────────────────────────

TOOL_PERMISSION_MAP: dict[str, PermissionState] = {
    # Read-only tools — safe to run without confirmation
    "get_specialist": PermissionState.ALLOW,
    "get_quiz": PermissionState.ALLOW,
    "search_course_content": PermissionState.ALLOW,
    "extract_key_points": PermissionState.ALLOW,
    # Write tools — modify student state, require confirmation
    "update_mastery": PermissionState.ASK,
    "create_study_plan": PermissionState.ASK,
    "generate_flashcards": PermissionState.ASK,
    "submit_quiz_answers": PermissionState.ASK,
    # Destructive tools — blocked for AI
    "delete_flashcard": PermissionState.DENY,
    "reset_progress": PermissionState.DENY,
}


class ToolPermissions:
    """Manages tool permission checks with per-session overrides.

    Default permissions come from TOOL_PERMISSION_MAP. Per-session
    overrides (set via set_override) take precedence. Unknown tools
    default to ASK for safety.
    """

    def __init__(self) -> None:
        self._overrides: dict[str, PermissionState] = {}

    def check(self, tool_name: str) -> PermissionState:
        """Check the permission state for a tool.

        Priority: session override > default map > ASK fallback.
        DENY cannot be overridden (safety invariant).
        """
        default = TOOL_PERMISSION_MAP.get(tool_name)

        # DENY is a hard block — overrides cannot weaken it
        if default is PermissionState.DENY:
            return PermissionState.DENY

        # Session override takes precedence (if not trying to override DENY)
        if tool_name in self._overrides:
            return self._overrides[tool_name]

        # Default map or fallback to ASK for unknown tools
        if default is not None:
            return default

        logger.debug(
            "Unknown tool '%s' — defaulting to ASK permission", tool_name
        )
        return PermissionState.ASK

    def set_override(self, tool_name: str, state: PermissionState) -> None:
        """Set a per-session permission override.

        Cannot override DENY tools — logs a warning and ignores.
        """
        default = TOOL_PERMISSION_MAP.get(tool_name)
        if default is PermissionState.DENY:
            logger.warning(
                "Cannot override DENY permission for tool '%s'", tool_name
            )
            return

        self._overrides[tool_name] = state
        logger.debug(
            "Permission override set: %s → %s", tool_name, state.value
        )

    def clear_overrides(self) -> None:
        """Clear all per-session overrides (e.g. on session end)."""
        self._overrides.clear()

    def get_allowed_tools(self, tool_names: list[str]) -> list[str]:
        """Filter tool names to only those with ALLOW permission.

        Useful for the executor to know which tools can run silently.
        """
        return [name for name in tool_names if self.check(name) is PermissionState.ALLOW]

    def get_confirmation_required(self, tool_names: list[str]) -> list[str]:
        """Filter tool names to those requiring user confirmation (ASK).

        The frontend should prompt the user before executing these.
        """
        return [name for name in tool_names if self.check(name) is PermissionState.ASK]

    def get_denied_tools(self, tool_names: list[str]) -> list[str]:
        """Filter tool names to those that are blocked (DENY).

        These should be excluded from the LLM's available tool list.
        """
        return [name for name in tool_names if self.check(name) is PermissionState.DENY]

    def describe_permissions(self, tool_names: list[str]) -> dict[str, str]:
        """Return a {tool_name: permission_state} dict for the given tools.

        Useful for debugging and for the frontend permission UI.
        """
        return {name: self.check(name).value for name in tool_names}
