"""
SolvX — AI Assistant API Router
===============================
Exposes endpoints for:
- Querying AI assistant status and availability
- Generating scientifically grounded AI explanations of oceanographic analysis
- Translating natural language requests into validated 3D visualization commands
"""

from typing import Optional
from fastapi import APIRouter, Header, HTTPException

from ..models.ai import (
    AnalysisQueryRequest,
    AIQueryResponse,
    NLCommandRequest,
    NLCommandResponse,
    AIStatusResponse
)
from ..services.ai_service import (
    get_ai_status,
    explain_analysis,
    parse_nl_command
)

router = APIRouter(prefix='/api/ai', tags=['Scientific AI Assistant'])


@router.get('/status', response_model=AIStatusResponse)
def status():
    """Returns AI Assistant operational status and active model configuration."""
    return get_ai_status()


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
