"""
SolvX — AI Scientific Assistant Orchestrator
============================================
Top-level entrypoint for the AI scientific assistant.
Coordinates conversation session state, executes deterministic Python/xarray
scientific tools, and delegates reasoning to the NVIDIA NIM AI agent.
"""

import logging
from typing import Optional

from .schemas import ChatRequest, ChatResponse
from .agent import GLOBAL_AGENT, SolvxNvidiaAgent

logger = logging.getLogger("solvx.ai.assistant")


def process_chat_message(
    request: ChatRequest,
    api_key: Optional[str] = None
) -> ChatResponse:
    """
    Main entrypoint for /api/ai/chat.
    Merges client UI context with session memory, runs the scientific planner,
    and synthesizes results via NVIDIA NIM inference.
    """
    return GLOBAL_AGENT.process_message(request, api_key=api_key)
