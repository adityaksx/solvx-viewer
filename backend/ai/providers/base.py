"""
SolvX — Common AI Provider Interface
====================================
Abstract base definition for all AI providers (Gemini, NVIDIA NIM).
Ensures complete decoupling between the SolvX AI Agent and underlying LLMs.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field


class ProviderResponse(BaseModel):
    """Normalized response returned from any AIProvider implementation."""
    content: str = Field(..., description="Synthesized natural language explanation or answer")
    model: str = Field(..., description="Identifier of the specific model that generated the content")
    provider: str = Field(..., description="Provider identifier (e.g. 'gemini', 'nvidia')")
    fallback_used: bool = Field(False, description="Whether internal fallback model was invoked")
    latency_ms: Optional[float] = Field(None, description="Generation latency in milliseconds")
    raw_response: Optional[Dict[str, Any]] = Field(None, description="Optional raw payload")


class AIProvider(ABC):
    """Abstract interface that all SolvX AI backends must implement."""

    provider_id: str
    display_name: str

    @abstractmethod
    def generate(
        self,
        messages: List[Dict[str, str]],
        system_instruction: Optional[str] = None,
        temperature: float = 0.2,
        max_tokens: int = 2048,
        model: Optional[str] = None,
        api_key: Optional[str] = None,
        **kwargs
    ) -> ProviderResponse:
        """
        Executes a prompt completion through the provider.
        Must raise a provider-specific exception on failure.
        """
        pass

    @abstractmethod
    def get_status(self) -> Dict[str, Any]:
        """
        Returns health and configuration metadata for this provider.
        Must never expose raw API keys or secrets.
        """
        pass

    @abstractmethod
    def test_connection(
        self,
        model: Optional[str] = None,
        api_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Runs a lightweight test query to verify API key validity and network latency.
        Returns: { 'success': bool, 'provider': str, 'model': str, 'latency_ms': float, 'status': str, 'message': str }
        """
        pass

    @abstractmethod
    def get_available_models(self) -> List[Dict[str, str]]:
        """Returns the list of supported models belonging exclusively to this provider."""
        pass

    def is_available(self) -> bool:
        """Returns True if this provider has an API key configured."""
        return bool(getattr(self, "api_key", None))

