"""
SolvX — Google Gemini AI Provider Implementation
=================================================
Implements the AIProvider interface using the official Google GenAI SDK.
"""

import time
import logging
from typing import Dict, Any, List, Optional
from google import genai
from google.genai import types

from ..config import GEMINI_API_KEY, DEFAULT_GEMINI_MODEL, GEMINI_MODEL_CATALOG, GEMINI_REQUEST_TIMEOUT
from .base import AIProvider, ProviderResponse

logger = logging.getLogger("solvx.ai.providers.gemini")


class GeminiAPIError(Exception):
    """Base exception for Gemini provider failures."""
    pass


class GeminiAuthenticationError(GeminiAPIError):
    """Raised when Gemini API key is missing or invalid."""
    pass


class GeminiUnavailableError(GeminiAPIError):
    """Raised when Gemini API endpoint is unreachable or model is invalid."""
    pass


class GeminiProvider(AIProvider):
    """Google Gemini AI Provider for SolvX Scientific Ocean Intelligence."""

    provider_id = "gemini"
    display_name = "Google Gemini"

    def __init__(self, api_key: Optional[str] = None):
        self._api_key = (api_key or GEMINI_API_KEY or "").strip()

    @property
    def api_key(self) -> str:
        return (self._api_key or GEMINI_API_KEY or "").strip()

    def get_available_models(self) -> List[Dict[str, str]]:
        return list(GEMINI_MODEL_CATALOG)

    def get_status(self) -> Dict[str, Any]:
        key_present = bool(self.api_key)
        return {
            "provider_id": self.provider_id,
            "display_name": self.display_name,
            "configured": key_present,
            "status": "Available" if key_present else "Not configured",
            "default_model": DEFAULT_GEMINI_MODEL,
            "models": self.get_available_models()
        }

    def _get_client(self, api_key: str):
        return genai.Client(api_key=api_key)

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
            raise GeminiAuthenticationError("GEMINI_API_KEY is not configured on the server.")

        active_model = model or DEFAULT_GEMINI_MODEL

        # Format prompt from conversation messages
        user_content_parts = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "system" and not system_instruction:
                system_instruction = content
            else:
                user_content_parts.append(f"[{role.upper()}]: {content}")

        combined_prompt = "\n\n".join(user_content_parts)

        models_to_try = [active_model]
        for m in [DEFAULT_GEMINI_MODEL, "gemini-3.8-flash", "gemini-3.8-pro", "gemini-1.5-flash"]:
            if m not in models_to_try:
                models_to_try.append(m)

        last_error = None
        start_time = time.time()
        client = self._get_client(active_key)
        config = types.GenerateContentConfig(
            temperature=temperature,
            max_output_tokens=max_tokens
        )
        if system_instruction:
            config.system_instruction = system_instruction

        for idx, try_model in enumerate(models_to_try):
            try:
                chat = client.chats.create(model=try_model, config=config)
                res = chat.send_message(combined_prompt)
                latency_ms = round((time.time() - start_time) * 1000, 1)

                if not res or not res.text:
                    raise GeminiUnavailableError(f"Gemini model '{try_model}' returned an empty response.")

                return ProviderResponse(
                    content=res.text.strip(),
                    model=try_model,
                    provider=self.provider_id,
                    fallback_used=(idx > 0),
                    latency_ms=latency_ms
                )
            except Exception as e:
                err_msg = str(e)
                last_error = e
                logger.warning(f"[Gemini Provider] Model '{try_model}' failed: {err_msg}")
                if "API_KEY_INVALID" in err_msg or "401" in err_msg or "403" in err_msg:
                    raise GeminiAuthenticationError(f"Gemini authentication failed: {err_msg}")
                # If 404 or NOT_FOUND, continue trying next candidate model
                if "404" in err_msg or "NOT_FOUND" in err_msg or "not found" in err_msg.lower():
                    continue
                break

        raise GeminiUnavailableError(f"Gemini generation failed: {last_error}")

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
                "model": model or DEFAULT_GEMINI_MODEL,
                "status": "Unavailable",
                "message": "API key is not configured on the server.",
                "latency_ms": None
            }

        active_model = model or DEFAULT_GEMINI_MODEL
        models_to_try = [active_model]
        for m in [DEFAULT_GEMINI_MODEL, "gemini-3.8-flash", "gemini-1.5-flash"]:
            if m not in models_to_try:
                models_to_try.append(m)

        start_time = time.time()
        client = self._get_client(active_key)

        for try_model in models_to_try:
            try:
                chat = client.chats.create(
                    model=try_model,
                    config=types.GenerateContentConfig(
                        temperature=0.1,
                        max_output_tokens=10
                    )
                )
                res = chat.send_message("Ping test for SolvX connection. Reply with 'OK'.")
                latency_ms = round((time.time() - start_time) * 1000, 1)

                if res and res.text:
                    return {
                        "success": True,
                        "provider": self.provider_id,
                        "model": try_model,
                        "status": "Available",
                        "message": f"Successfully connected to {try_model} ({latency_ms} ms)",
                        "latency_ms": latency_ms
                    }
            except Exception as e:
                err_msg = str(e)
                if "404" in err_msg or "NOT_FOUND" in err_msg:
                    continue
                return {
                    "success": False,
                    "provider": self.provider_id,
                    "model": try_model,
                    "status": "Unavailable",
                    "message": f"Connection failed: {err_msg}",
                    "latency_ms": round((time.time() - start_time) * 1000, 1)
                }

        return {
            "success": False,
            "provider": self.provider_id,
            "model": active_model,
            "status": "Unavailable",
            "message": "All tested Gemini models returned 404 NOT_FOUND.",
            "latency_ms": round((time.time() - start_time) * 1000, 1)
        }

