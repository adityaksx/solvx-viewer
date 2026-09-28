"""
SolvX — Multi-Provider AI Scientific Agent Orchestrator
======================================================
Coordinates deterministic scientific tool execution, multi-turn session state,
provider delegation (Gemini or NVIDIA NIM), and structured output formatting.
"""

import json
import logging
from typing import Optional, Dict, Any, List

from .schemas import ChatRequest, ChatResponse, VisualizationAction
from .context import session_memory
from .prompts import SYSTEM_INSTRUCTION
from .planner import ScientificPlanner
from .providers.base import ProviderResponse
from .providers.manager import AIProviderManager, GLOBAL_PROVIDER_MANAGER

logger = logging.getLogger("solvx.ai.agent")


class SolvxAIAgent:
    """Enterprise AI Agent for SolvX communicating exclusively through AIProviderManager."""

    def __init__(self, provider_manager: Optional[AIProviderManager] = None):
        self.planner = ScientificPlanner()
        self.provider_manager = provider_manager or GLOBAL_PROVIDER_MANAGER

    def process_message(
        self,
        request: ChatRequest,
        api_key: Optional[str] = None
    ) -> ChatResponse:
        """
        Main entrypoint for SolvX AI Assistant chat processing.
        1. Merges UI context and session state.
        2. Executes deterministic Python/xarray tools.
        3. Synthesizes output via active AIProvider (Gemini or NVIDIA NIM).
        4. Validates structured visualization commands and returns ChatResponse.
        """
        session_id = request.session_id or "default_session"
        merged_context = session_memory.merge_ui_and_session_context(request.context, session_id)
        session_updates: Dict[str, Any] = {}

        message = request.message.strip()

        # 1. Run deterministic planner first to execute required tools and validate coordinates
        deterministic_response = self.planner.plan_and_execute(
            message=message,
            merged_context=merged_context,
            session_updates=session_updates
        )

        # 2. Check if we should synthesize using LLM provider
        is_error_response = deterministic_response.response_type == "ERROR"
        is_skipped_tool = any(tc.status == "skipped" for tc in deterministic_response.tool_calls)

        active_provider_id = (request.provider or self.provider_manager.selected_provider).strip().lower()

        if not is_error_response and not is_skipped_tool:
            tool_data_summary = {
                "tool_calls": [tc.model_dump() for tc in deterministic_response.tool_calls],
                "computed_metrics_summary": deterministic_response.message,
                "ui_context": merged_context
            }

            user_prompt = (
                f"User Question:\n{message}\n\n"
                f"Computed Deterministic Metrics from SolvX Tools:\n"
                f"{json.dumps(tool_data_summary, indent=2)}\n\n"
                "Please synthesize a rigorous, clear scientific explanation strictly grounded in the computed metrics above. "
                "Follow all scientific guardrails (distinguish observed facts vs model calculations vs inferences). "
                "Do NOT invent or alter any numerical values. "
                "Optionally, if appropriate to the user's intent, mention any relevant 3D viewer actions."
            )

            messages = [
                {"role": "system", "content": SYSTEM_INSTRUCTION},
                {"role": "user", "content": user_prompt}
            ]

            try:
                provider_res: ProviderResponse = self.provider_manager.generate(
                    messages=messages,
                    system_instruction=SYSTEM_INSTRUCTION,
                    temperature=0.2,
                    max_tokens=2048,
                    preferred_provider=request.provider,
                    preferred_model=request.model,
                    api_key=api_key
                )

                if provider_res and provider_res.content:
                    deterministic_response.message = provider_res.content
                    deterministic_response.explanation = provider_res.content
                    deterministic_response.answer = provider_res.content
                    deterministic_response.model = provider_res.model
                    deterministic_response.provider = provider_res.provider
                    deterministic_response.fallback_used = provider_res.fallback_used
                    deterministic_response.success = True

            except Exception as e:
                logger.warning(f"[SolvX AI Agent] Provider '{active_provider_id}' generation failed: {e}")
                # Report provider failure cleanly without silently creating a fake answer
                deterministic_response.provider = active_provider_id
                deterministic_response.model = request.model or self.provider_manager.selected_models.get(active_provider_id)
                deterministic_response.success = False
                deterministic_response.error = {
                    "type": type(e).__name__,
                    "message": str(e)
                }

        # Persist session state
        session_updates['last_user_message'] = message
        session_updates['last_response_type'] = deterministic_response.response_type
        session_memory.update_session(session_id, session_updates)
        deterministic_response.session_id = session_id

        return deterministic_response

    def chat(self, request: ChatRequest, api_key: Optional[str] = None) -> ChatResponse:
        """Alias for process_message."""
        return self.process_message(request, api_key=api_key)



# Global Agent instance and backward-compatibility aliases
GLOBAL_AGENT = SolvxAIAgent()
SolvxNvidiaAgent = SolvxAIAgent

