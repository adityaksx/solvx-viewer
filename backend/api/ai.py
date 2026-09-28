"""
SolvX — AI Assistant & Multi-Provider API Router
=================================================
Exposes endpoints for:
- Querying and updating AI assistant settings (provider, model, auto-fallback)
- Diagnostic provider connection testing with latency measurement
- Conversational oceanographic analysis orchestration (Gemini & NVIDIA NIM)
- Translating natural language requests into validated 3D visualization commands
"""

from typing import Optional, Dict, Any
from fastapi import APIRouter, Header, HTTPException

from ..models.ai import (
    AnalysisQueryRequest,
    AIQueryResponse,
    NLCommandRequest,
    NLCommandResponse,
    AIStatusResponse
)
from ..ai.schemas import (
    ChatRequest,
    ChatResponse,
    AISettingsUpdateRequest,
    TestConnectionRequest
)
from ..ai.assistant import process_chat_message
from ..ai.providers.manager import GLOBAL_PROVIDER_MANAGER
from ..services.ai_service import (
    get_ai_status,
    explain_analysis,
    parse_nl_command
)

router = APIRouter(prefix='/api/ai', tags=['Scientific AI Assistant'])


# =============================================================================
# Settings and Multi-Provider Diagnostics
# =============================================================================

@router.get('/settings')
def get_settings():
    """Returns currently selected provider, model, auto-fallback toggle, and provider status."""
    try:
        return GLOBAL_PROVIDER_MANAGER.get_settings_summary()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed retrieving AI settings: {str(e)}")


@router.post('/settings')
def update_settings(request: AISettingsUpdateRequest):
    """Updates active AI provider, model selection, or cross-provider fallback preference."""
    try:
        return GLOBAL_PROVIDER_MANAGER.update_settings(
            provider=request.provider,
            model=request.model,
            auto_fallback=request.auto_fallback
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed updating AI settings: {str(e)}")


@router.post('/test-connection')
def test_connection(
    request: TestConnectionRequest,
    x_nvidia_key: Optional[str] = Header(None, alias='X-Nvidia-Key'),
    x_gemini_key: Optional[str] = Header(None, alias='X-Gemini-Key')
):
    """Executes a diagnostic latency ping against Google Gemini or NVIDIA NIM."""
    try:
        api_key = x_nvidia_key if request.provider == "nvidia" else x_gemini_key
        return GLOBAL_PROVIDER_MANAGER.test_connection(
            provider_id=request.provider,
            model=request.model,
            api_key=api_key
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Connection test failed: {str(e)}")


@router.get('/status', response_model=AIStatusResponse)
def status():
    """Returns AI Assistant operational status and active model configuration."""
    return get_ai_status()


# =============================================================================
# Conversational AI & Command Endpoints
# =============================================================================

@router.post('/chat', response_model=ChatResponse)
def chat(
    request: ChatRequest,
    x_nvidia_key: Optional[str] = Header(None, alias='X-Nvidia-Key'),
    x_gemini_key: Optional[str] = Header(None, alias='X-Gemini-Key')
):
    """
    Main conversational orchestration endpoint for the SolvX AI Scientific Assistant.
    Follows Section 19 of specification:
    - Interprets natural-language intent.
    - Decides required datasets/variables.
    - Deterministically retrieves/processes data via SolvX tools.
    - Synthesizes findings using the selected provider (Gemini or NVIDIA NIM).
    - Returns structured answer with text, charts, 3D visualization actions, and provenance.
    """
    try:
        provider = request.provider or GLOBAL_PROVIDER_MANAGER.selected_provider
        api_key = x_nvidia_key if provider == "nvidia" else (x_gemini_key or x_nvidia_key)
        return process_chat_message(request, api_key=api_key)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI chat orchestration failed: {str(e)}")


@router.post('/explain', response_model=AIQueryResponse)
def explain(
    request: AnalysisQueryRequest,
    x_gemini_key: Optional[str] = Header(None, alias='X-Gemini-Key')
):
    """
    Generates a natural-language oceanographic analysis explanation
    grounded strictly in computed metrics (Model vs Argo, coverage, gaps, anomalies).
    """
    try:
        return explain_analysis(
            question=request.question,
            variable=request.variable,
            method=request.method,
            client_context=request.context,
            api_key=x_gemini_key
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI explanation failed: {str(e)}")


@router.post('/query', response_model=AIQueryResponse)
def query(
    request: AnalysisQueryRequest,
    x_gemini_key: Optional[str] = Header(None, alias='X-Gemini-Key')
):
    """Alias for /explain conforming to plan.md specification."""
    return explain(request, x_gemini_key)


@router.post('/command', response_model=NLCommandResponse)
def command(
    request: NLCommandRequest,
    x_gemini_key: Optional[str] = Header(None, alias='X-Gemini-Key')
):
    """
    Translates a natural language instruction into a validated VisualizationCommand
    to be executed by the 3D viewer.
    """
    try:
        return parse_nl_command(
            text=request.text,
            variable=request.variable,
            api_key=x_gemini_key
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Command parsing failed: {str(e)}")
