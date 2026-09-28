"""
SolvX — NVIDIA NIM AI Provider Implementation
==============================================
Implements the AIProvider interface using the OpenAI-compatible NVIDIA NIM inference layer.
"""

import time
import logging
from typing import Dict, Any, List, Optional

from ..config import (
    NVIDIA_API_KEY,
    NVIDIA_BASE_URL,
    DEFAULT_NVIDIA_MODEL,
    NVIDIA_MODEL_CATALOG,
    NVIDIA_REQUEST_TIMEOUT
)
from ..nvidia_client import (
    NvidiaClient,
    NvidiaAPIError,
    NvidiaAuthenticationError,
    NvidiaRateLimitError,
    NvidiaServerError,
    NvidiaTimeoutError,
    NvidiaModelUnavailableError
)
from ..model_manager import ModelManager, GLOBAL_MODEL_MANAGER
from .base import AIProvider, ProviderResponse

logger = logging.getLogger("solvx.ai.providers.nvidia")


class NVIDIAProvider(AIProvider):
    """NVIDIA NIM Provider for SolvX Scientific Ocean Intelligence."""

    provider_id = "nvidia"
    display_name = "NVIDIA NIM"

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_manager: Optional[ModelManager] = None,
        client: Optional[NvidiaClient] = None
    ):
        self._api_key = (api_key or NVIDIA_API_KEY or "").strip()
        self.model_manager = model_manager or GLOBAL_MODEL_MANAGER
        self._client = client

    @property
    def api_key(self) -> str:
        return (self._api_key or NVIDIA_API_KEY or "").strip()

    def get_available_models(self) -> List[Dict[str, str]]:
        return list(NVIDIA_MODEL_CATALOG)

    def get_status(self) -> Dict[str, Any]:
        key_present = bool(self.api_key)
        return {
            "provider_id": self.provider_id,
            "display_name": self.display_name,
            "configured": key_present,
            "status": "Available" if key_present else "Not configured",
            "default_model": DEFAULT_NVIDIA_MODEL,
            "models": self.get_available_models()
        }

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
        active_key = (api_key or self.api_key or "").strip()
        if not active_key:
            raise NvidiaAuthenticationError("NVIDIA_API_KEY is not configured on the server.")

        client = self._client or NvidiaClient(api_key=active_key, timeout=NVIDIA_REQUEST_TIMEOUT)


        formatted_messages = []
        if system_instruction:
            formatted_messages.append({"role": "system", "content": system_instruction})
        formatted_messages.extend(messages)

        preferred_model = model or DEFAULT_NVIDIA_MODEL
        start_time = time.time()

        raw_res, model_used, was_fallback = self.model_manager.execute_chat_with_fallback(
            client=client,
            messages=formatted_messages,
            temperature=temperature,
            max_tokens=max_tokens,
            preferred_model=preferred_model,
            **kwargs
        )
        latency_ms = round((time.time() - start_time) * 1000, 1)

        choices = raw_res.get("choices", [])
        if not choices:
            raise NvidiaAPIError(f"NVIDIA NIM model '{model_used}' returned no choices in response.")

        content = choices[0].get("message", {}).get("content", "").strip()
        if not content:
            raise NvidiaAPIError(f"NVIDIA NIM model '{model_used}' returned an empty message.")

        return ProviderResponse(
            content=content,
            model=model_used,
            provider=self.provider_id,
            fallback_used=was_fallback,
            latency_ms=latency_ms,
            raw_response=raw_res
        )

    def test_connection(
        self,
        model: Optional[str] = None,
        api_key: Optional[str] = None
    ) -> Dict[str, Any]:
        active_key = (api_key or self.api_key or "").strip()
        if not active_key:
            return {
                "success": False,
                "provider": self.provider_id,
                "model": model or DEFAULT_NVIDIA_MODEL,
                "status": "Unavailable",
                "message": "API key is not configured on the server.",
                "latency_ms": None
            }

        active_model = model or DEFAULT_NVIDIA_MODEL
        client = NvidiaClient(api_key=active_key, timeout=10.0)
        start_time = time.time()

        try:
            res = client.chat_completion(
                model=active_model,
                messages=[{"role": "user", "content": "Ping test for SolvX connection. Reply with 'OK'."}],
                temperature=0.1,
                max_tokens=10
            )
            latency_ms = round((time.time() - start_time) * 1000, 1)
            choices = res.get("choices", [])
            if choices and choices[0].get("message", {}).get("content"):
                return {
                    "success": True,
                    "provider": self.provider_id,
                    "model": active_model,
                    "status": "Available",
                    "message": f"Successfully connected ({latency_ms} ms)",
                    "latency_ms": latency_ms
                }
            return {
                "success": False,
                "provider": self.provider_id,
                "model": active_model,
                "status": "Unavailable",
                "message": "Model returned an empty response.",
                "latency_ms": latency_ms
            }
        except Exception as e:
            latency_ms = round((time.time() - start_time) * 1000, 1)
            return {
                "success": False,
                "provider": self.provider_id,
                "model": active_model,
                "status": "Unavailable",
                "message": f"Connection test failed: {str(e)}",
                "latency_ms": latency_ms
            }
