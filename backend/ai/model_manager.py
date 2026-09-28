"""
SolvX — NVIDIA NIM Model Manager & Fallback Engine
==================================================
Manages the 6-tier model priority hierarchy, availability tracking,
cooldown periods, cached model selection, and automatic failover.
"""

import time
import logging
from typing import List, Dict, Any, Optional, Tuple

from .config import (
    NVIDIA_MODEL_PRIORITY,
    NVIDIA_PRIMARY_MODEL,
    NVIDIA_CACHE_TTL_SECONDS
)
from .nvidia_client import (
    NvidiaClient,
    NvidiaAPIError,
    NvidiaAuthenticationError,
    NvidiaRateLimitError,
    NvidiaServerError,
    NvidiaTimeoutError,
    NvidiaModelUnavailableError,
    NvidiaConnectionError
)

logger = logging.getLogger("solvx.ai.model_manager")


class ModelManager:
    """
    Coordinates model selection across the 6-tier NVIDIA priority list.
    Maintains health records, cooldowns, and ensures low-latency execution.
    """

    def __init__(self, priority_list: Optional[List[str]] = None, cache_ttl: int = NVIDIA_CACHE_TTL_SECONDS):
        self.priority_list: List[str] = list(priority_list or NVIDIA_MODEL_PRIORITY)
        self.cache_ttl = cache_ttl

        # State tracking
        self._active_model: Optional[str] = None
        self._active_model_timestamp: float = 0.0
        self._unhealthy_models: Dict[str, float] = {}  # model -> cooldown_expiry_timestamp
        self._consecutive_failures: Dict[str, int] = {m: 0 for m in self.priority_list}

    def get_candidate_models(self) -> List[str]:
        """Returns models in priority order, prioritizing the cached active model if healthy."""
        now = time.time()

        # Clean expired cooldowns
        expired = [m for m, expiry in self._unhealthy_models.items() if now > expiry]
        for m in expired:
            del self._unhealthy_models[m]
            self._consecutive_failures[m] = 0

        # If we have a healthy cached active model within TTL, start with it
        if self._active_model and self._active_model not in self._unhealthy_models:
            if (now - self._active_model_timestamp) < self.cache_ttl:
                candidates = [self._active_model] + [m for m in self.priority_list if m != self._active_model]
                return [m for m in candidates if m not in self._unhealthy_models]

        # Otherwise use priority order filtering out unhealthy models
        healthy = [m for m in self.priority_list if m not in self._unhealthy_models]
        if not healthy:
            # If all are in cooldown, reset cooldowns to give primary another chance
            self._unhealthy_models.clear()
            return list(self.priority_list)

        return healthy

    def mark_success(self, model: str) -> None:
        """Records successful response from a model and updates active cache."""
        self._active_model = model
        self._active_model_timestamp = time.time()
        self._consecutive_failures[model] = 0
        if model in self._unhealthy_models:
            del self._unhealthy_models[model]
        logger.info(f"[NVIDIA] Model selected: {model}")

    def mark_failure(self, model: str, error: Exception, cooldown_seconds: float = 60.0) -> None:
        """Flags model as unhealthy for a cooldown duration."""
        self._consecutive_failures[model] = self._consecutive_failures.get(model, 0) + 1
        # Backoff multiplier for repeated failures
        factor = min(self._consecutive_failures[model], 5)
        self._unhealthy_models[model] = time.time() + (cooldown_seconds * factor)
        logger.warning(f"[NVIDIA] Request failed: model {model} failed: {error}")

        # If active model failed, invalidate cache
        if self._active_model == model:
            self._active_model = None

    def execute_chat_with_fallback(
        self,
        client: NvidiaClient,
        messages: List[Dict[str, str]],
        temperature: float = 0.2,
        max_tokens: int = 2048,
        preferred_model: Optional[str] = None,
        **kwargs
    ) -> Tuple[Dict[str, Any], str, bool]:
        """
        Executes chat completion with automatic failover across candidate models.
        Returns: (raw_response_dict, model_used, was_fallback)
        """
        candidates = self.get_candidate_models()
        if preferred_model and preferred_model in self.priority_list:
            if preferred_model in candidates:
                candidates.remove(preferred_model)
            candidates.insert(0, preferred_model)

        primary_candidate = self.priority_list[0] if self.priority_list else None
        last_error: Optional[Exception] = None
        attempted_models: List[str] = []

        for idx, model in enumerate(candidates):
            attempted_models.append(model)
            logger.info(f"[NVIDIA] Trying model: {model}")

            try:
                response = client.chat_completion(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    **kwargs
                )
                self.mark_success(model)
                was_fallback = (model != primary_candidate)
                return response, model, was_fallback

            except NvidiaAuthenticationError as auth_err:
                # Auth error means invalid API key -> no model will succeed
                logger.error(f"[NVIDIA] Authentication error with key: {auth_err}")
                self.mark_failure(model, auth_err, cooldown_seconds=300.0)
                raise auth_err

            except (NvidiaRateLimitError, NvidiaServerError, NvidiaTimeoutError,
                    NvidiaModelUnavailableError, NvidiaConnectionError, NvidiaAPIError) as err:
                last_error = err
                next_model = candidates[idx + 1] if idx + 1 < len(candidates) else "None"
                logger.warning(f"[NVIDIA] Fallback: from {model} to {next_model} due to {err}")
                self.mark_failure(model, err, cooldown_seconds=60.0)
                continue

            except Exception as unk_err:
                last_error = unk_err
                logger.warning(f"[NVIDIA] Fallback: unexpected error on {model}: {unk_err}")
                self.mark_failure(model, unk_err, cooldown_seconds=60.0)
                continue

        logger.error(f"[NVIDIA] All configured models unavailable. Attempted: {attempted_models}")
        raise NvidiaAPIError(f"All configured NVIDIA models failed. Last error: {last_error}")


# Singleton model manager instance
GLOBAL_MODEL_MANAGER = ModelManager()
