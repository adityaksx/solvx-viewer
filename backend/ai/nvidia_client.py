"""
SolvX — NVIDIA NIM OpenAI-Compatible API Client
================================================
Handles network communication, timeout policies, connection pooling,
and error normalization for NVIDIA NIM hosted LLMs.
"""

import json
import logging
from typing import Dict, Any, List, Optional, Union
import httpx

from .config import NVIDIA_BASE_URL, NVIDIA_API_KEY, NVIDIA_REQUEST_TIMEOUT

logger = logging.getLogger("solvx.ai.nvidia_client")


# =============================================================================
# Custom Exception Hierarchy
# =============================================================================

class NvidiaAPIError(Exception):
    """Base exception for all NVIDIA NIM API errors."""
    def __init__(self, message: str, status_code: Optional[int] = None, response_body: Optional[Any] = None):
        super().__init__(message)
        self.status_code = status_code
        self.response_body = response_body


class NvidiaAuthenticationError(NvidiaAPIError):
    """Raised when API key is missing, unauthorized, or invalid (HTTP 401/403)."""
    pass


class NvidiaRateLimitError(NvidiaAPIError):
    """Raised when rate limit is exceeded (HTTP 429)."""
    pass


class NvidiaServerError(NvidiaAPIError):
    """Raised on upstream 5xx errors (HTTP 500, 502, 503, 504)."""
    pass


class NvidiaTimeoutError(NvidiaAPIError):
    """Raised when API call times out."""
    pass


class NvidiaModelUnavailableError(NvidiaAPIError):
    """Raised when the requested model is not available or unrecognized."""
    pass


class NvidiaConnectionError(NvidiaAPIError):
    """Raised on network failure / connection error."""
    pass


# =============================================================================
# NVIDIA Client
# =============================================================================

class NvidiaClient:
    """Client for interacting with NVIDIA's OpenAI-compatible inference endpoints."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: Optional[float] = None,
        http_client: Optional[httpx.Client] = None
    ):
        self.api_key = (api_key or NVIDIA_API_KEY or "").strip()
        self.base_url = (base_url or NVIDIA_BASE_URL).rstrip("/")
        self.timeout = timeout if timeout is not None else NVIDIA_REQUEST_TIMEOUT
        self._external_client = http_client

    def _get_client(self) -> httpx.Client:
        if self._external_client is not None:
            return self._external_client
        return httpx.Client(
            base_url=self.base_url,
            timeout=self.timeout,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "User-Agent": "SolvX-Ocean-AI/1.0"
            }
        )

    def chat_completion(
        self,
        model: str,
        messages: List[Dict[str, str]],
        temperature: float = 0.2,
        max_tokens: int = 2048,
        top_p: float = 0.95,
        response_format: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Sends a chat completion request to the NVIDIA NIM endpoint.
        Returns the raw parsed JSON response dictionary.
        """
        if not self.api_key:
            raise NvidiaAuthenticationError("NVIDIA_API_KEY is missing or empty. Please set it in backend configuration.")

        endpoint = f"{self.base_url}/chat/completions"
        payload: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "top_p": top_p,
            **kwargs
        }
        if response_format:
            payload["response_format"] = response_format

        client = self._get_client()
        should_close = self._external_client is None

        try:
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "User-Agent": "SolvX-Ocean-AI/1.0"
            }
            response = client.post(endpoint, json=payload, headers=headers, timeout=self.timeout)

            # Error Normalization
            if response.status_code == 401 or response.status_code == 403:
                raise NvidiaAuthenticationError(
                    f"Authentication failed with status {response.status_code}",
                    status_code=response.status_code
                )

            if response.status_code == 429:
                raise NvidiaRateLimitError(
                    "Rate limit exceeded (HTTP 429)",
                    status_code=429
                )

            if response.status_code == 404:
                raise NvidiaModelUnavailableError(
                    f"Model '{model}' or endpoint not found (HTTP 404)",
                    status_code=404
                )

            if response.status_code >= 500:
                raise NvidiaServerError(
                    f"NVIDIA NIM server error (HTTP {response.status_code})",
                    status_code=response.status_code
                )

            if response.status_code >= 400:
                # Other 4xx errors
                body_text = response.text
                if "model" in body_text.lower() and ("not found" in body_text.lower() or "invalid" in body_text.lower() or "does not exist" in body_text.lower()):
                    raise NvidiaModelUnavailableError(
                        f"Model '{model}' is invalid or unavailable: {body_text}",
                        status_code=response.status_code,
                        response_body=body_text
                    )
                raise NvidiaAPIError(
                    f"API request failed with HTTP {response.status_code}: {body_text}",
                    status_code=response.status_code,
                    response_body=body_text
                )

            return response.json()

        except httpx.TimeoutException as e:
            raise NvidiaTimeoutError(f"Request to model '{model}' timed out after {self.timeout}s: {e}")
        except httpx.NetworkError as e:
            raise NvidiaConnectionError(f"Network error connecting to NVIDIA API: {e}")
        finally:
            if should_close:
                try:
                    client.close()
                except Exception:
                    pass
