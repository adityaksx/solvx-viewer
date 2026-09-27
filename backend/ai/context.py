"""
SolvX — AI Conversation Session Context Manager
================================================
Section 22 of the specification:
Maintains explicit, inspectable short-lived conversation state across
multi-turn scientific interactions (e.g. follow-up questions).
"""

import time
from typing import Dict, Any, Optional
from .schemas import UIContext, RegionContext, TimelineContext, DepthContext


class SessionMemory:
    """Stores short-lived session context for multi-turn scientific follow-ups."""
    def __init__(self, ttl_seconds: int = 1800):
        self.ttl = ttl_seconds
        self._sessions: Dict[str, Dict[str, Any]] = {}

    def get_session(self, session_id: Optional[str]) -> Dict[str, Any]:
        if not session_id:
            return {}
        data = self._sessions.get(session_id)
        if not data:
            return {}
        if time.time() - data.get('_last_updated', 0) > self.ttl:
            del self._sessions[session_id]
            return {}
        return data

    def update_session(self, session_id: str, updates: Dict[str, Any]):
        if not session_id:
            return
        current = self.get_session(session_id)
        current.update(updates)
        current['_last_updated'] = time.time()
        self._sessions[session_id] = current

    def merge_ui_and_session_context(
        self,
        ui_context: Optional[UIContext],
        session_id: Optional[str]
    ) -> Dict[str, Any]:
        """
        Merges UI-provided context with stored session memory.
        Explicit UI selections take precedence, with session filling gaps.
        """
        session_state = self.get_session(session_id)
        merged: Dict[str, Any] = dict(session_state)

        if ui_context:
            if ui_context.region:
                merged['region'] = ui_context.region.model_dump(exclude_none=True)
            if ui_context.timeline:
                merged['timeline'] = ui_context.timeline.model_dump(exclude_none=True)
            if ui_context.depth:
                merged['depth'] = ui_context.depth.model_dump(exclude_none=True)
            if ui_context.selected_variable:
                merged['variable'] = ui_context.selected_variable
            if ui_context.visualization_state:
                merged['visualization'] = ui_context.visualization_state.model_dump(exclude_none=True)

        return merged


# Global in-memory session manager
session_memory = SessionMemory()
