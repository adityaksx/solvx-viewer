"""
SolvX — AI Scientific Assistant Orchestrator
============================================
Top-level entrypoint for the AI scientific assistant.
Manages conversation session state, coordinates LLM generation with
Google GenAI SDK (Gemini), and guarantees deterministic fallback execution.
"""

import json
import logging
from typing import Optional, Dict, Any
from google import genai
from google.genai import types

from ..config import GEMINI_API_KEY, GEMINI_MODEL
from .schemas import ChatRequest, ChatResponse, UIContext
from .context import session_memory
from .prompts import SYSTEM_INSTRUCTION
from .planner import ScientificPlanner

logger = logging.getLogger("solvx.ai.assistant")
planner = ScientificPlanner()


def process_chat_message(
    request: ChatRequest,
    api_key: Optional[str] = None
) -> ChatResponse:
    """
    Main entrypoint for /api/ai/chat.
    Merges client UI context with session memory, runs the scientific planner,
    and returns a fully structured, scientifically validated ChatResponse.
    """
    session_id = request.session_id or "default_session"
    merged_context = session_memory.merge_ui_and_session_context(request.context, session_id)
    session_updates: Dict[str, Any] = {}

    key = api_key or GEMINI_API_KEY
    message = request.message.strip()

    # Run deterministic planner first to ensure all required data/tools are executed
    # and all guardrails (coordinates, unavailable variables, generic science) are respected
    deterministic_response = planner.plan_and_execute(
        message=message,
        merged_context=merged_context,
        session_updates=session_updates
    )

    # If Gemini API key is available and query is not a coordinate validation error or unhandled query,
    # we can use Gemini to synthesize the natural-language scientific explanation
    if key and key.strip() and deterministic_response.response_type != "ERROR":
        try:
            client = genai.Client(api_key=key.strip())
            active_model = request.model or GEMINI_MODEL or "gemini-2.0-flash"

            tool_data_summary = {
                "tool_calls": [tc.model_dump() for tc in deterministic_response.tool_calls],
                "deterministic_metrics": deterministic_response.message,
                "context": merged_context
            }

            prompt = (
                f"User Question: {message}\n\n"
                f"Computed Structured Metrics from SolvX Tools:\n"
                f"{json.dumps(tool_data_summary, indent=2)}\n\n"
                "Please synthesize a clear, scientifically accurate explanation strictly grounded in the computed metrics above. "
                "Do NOT invent or alter any numerical values. Follow all scientific guardrails."
            )

            res = client.models.generate_content(
                model=active_model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_INSTRUCTION,
                    temperature=0.2,
                )
            )

            if res and res.text and len(res.text.strip()) > 30:
                # Retain all deterministic tool calls, charts, actions, and provenance,
                # only enhancing the natural language prose
                deterministic_response.message = res.text.strip()
        except Exception as e:
            logger.warning(f"[SolvX AI Assistant] Gemini generation skipped/fallback due to: {e}")

    # Persist session context
    session_updates['last_user_message'] = message
    session_updates['last_response_type'] = deterministic_response.response_type
    session_memory.update_session(session_id, session_updates)
    deterministic_response.session_id = session_id

    return deterministic_response
