"""
SolvX — AI Provider Manager
===========================
Coordinates provider selection, model configuration, persistent settings,
and request routing between Google Gemini and NVIDIA NIM.
"""

import json
import logging
from typing import Dict, Any, List, Optional
from pathlib import Path

from ..config import (
    DEFAULT_AI_PROVIDER,
    DEFAULT_GEMINI_MODEL,
    DEFAULT_NVIDIA_MODEL,
    AUTO_PROVIDER_FALLBACK,
    AI_SETTINGS_FILE
)
from .base import AIProvider, ProviderResponse
from .gemini_provider import GeminiProvider
from .nvidia_provider import NVIDIAProvider

logger = logging.getLogger("solvx.ai.providers.manager")


class AIProviderManager:
    """Manages multi-provider selection, settings persistence, and execution routing."""

    def __init__(self, settings_path: Optional[Path] = None):
        self.settings_path = settings_path or AI_SETTINGS_FILE
        self.gemini_provider = GeminiProvider()
        self.nvidia_provider = NVIDIAProvider()

        self.providers: Dict[str, AIProvider] = {
            "gemini": self.gemini_provider,
            "nvidia": self.nvidia_provider
        }

        # Persistent runtime settings
        self.selected_provider: str = DEFAULT_AI_PROVIDER
        self.selected_models: Dict[str, str] = {
            "gemini": DEFAULT_GEMINI_MODEL,
            "nvidia": DEFAULT_NVIDIA_MODEL
        }
        self.auto_fallback: bool = AUTO_PROVIDER_FALLBACK

        self._load_settings()

    def _load_settings(self) -> None:
        """Loads persistent provider and model settings from JSON file if present."""
        if self.settings_path and self.settings_path.exists():
            try:
                with open(self.settings_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if data.get("selected_provider") in self.providers:
                        self.selected_provider = data["selected_provider"]
                    if "selected_models" in data and isinstance(data["selected_models"], dict):
                        self.selected_models.update(data["selected_models"])
                    if "auto_fallback" in data:
                        self.auto_fallback = bool(data["auto_fallback"])
            except Exception as e:
                logger.warning(f"[ProviderManager] Could not load settings from {self.settings_path}: {e}")

    def _save_settings(self) -> None:
        """Persists current settings to disk."""
        if self.settings_path:
            try:
                self.settings_path.parent.mkdir(parents=True, exist_ok=True)
                with open(self.settings_path, "w", encoding="utf-8") as f:
                    json.dump({
                        "selected_provider": self.selected_provider,
                        "selected_models": self.selected_models,
                        "auto_fallback": self.auto_fallback
                    }, f, indent=2)
            except Exception as e:
                logger.warning(f"[ProviderManager] Could not save settings to {self.settings_path}: {e}")

    def get_provider(self, provider_id: Optional[str] = None) -> AIProvider:
        """Returns requested or currently active AIProvider instance."""
        pid = (provider_id or self.selected_provider).strip().lower()
        if pid not in self.providers:
            logger.warning(f"[ProviderManager] Unknown provider '{pid}', falling back to '{DEFAULT_AI_PROVIDER}'")
            pid = DEFAULT_AI_PROVIDER
        return self.providers[pid]

    def update_settings(
        self,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        auto_fallback: Optional[bool] = None
    ) -> Dict[str, Any]:
        """Updates active provider, model selection, or fallback preference."""
        if provider:
            p_clean = provider.strip().lower()
            if p_clean in self.providers:
                self.selected_provider = p_clean
            else:
                raise ValueError(f"Unknown provider '{provider}'. Supported: {list(self.providers.keys())}")

        if model:
            cur_p = self.selected_provider
            self.selected_models[cur_p] = model.strip()

        if auto_fallback is not None:
            self.auto_fallback = bool(auto_fallback)

        self._save_settings()
        return self.get_settings_summary()

    def get_settings_summary(self) -> Dict[str, Any]:
        """Returns comprehensive settings and status report for UI and diagnostics."""
        return {
            "selected_provider": self.selected_provider,
            "selected_model": self.selected_models.get(self.selected_provider),
            "selected_models": self.selected_models,
            "auto_fallback": self.auto_fallback,
            "providers": {
                pid: prov.get_status()
                for pid, prov in self.providers.items()
            }
        }

    def test_connection(
        self,
        provider_id: str,
        model: Optional[str] = None,
        api_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """Runs test query against the specified provider."""
        prov = self.get_provider(provider_id)
        active_model = model or self.selected_models.get(prov.provider_id)
        return prov.test_connection(model=active_model, api_key=api_key)

    def generate(
        self,
        messages: List[Dict[str, str]],
        system_instruction: Optional[str] = None,
        temperature: float = 0.2,
        max_tokens: int = 2048,
        preferred_provider: Optional[str] = None,
        preferred_model: Optional[str] = None,
        api_key: Optional[str] = None,
        **kwargs
    ) -> ProviderResponse:
        """
        Executes generation through the active provider.
        If auto_fallback is False (default), failure raises provider error immediately.
        If auto_fallback is True, gracefully attempts the alternative provider.
        """
        primary_pid = (preferred_provider or self.selected_provider).strip().lower()
        if primary_pid not in self.providers:
            primary_pid = self.selected_provider

        primary_prov = self.providers[primary_pid]
        active_model = preferred_model or self.selected_models.get(primary_pid)

        try:
            return primary_prov.generate(
                messages=messages,
                system_instruction=system_instruction,
                temperature=temperature,
                max_tokens=max_tokens,
                model=active_model,
                api_key=api_key,
                **kwargs
            )
        except Exception as primary_error:
            # Check if cross-provider fallback is explicitly enabled
            if not self.auto_fallback:
                logger.warning(f"[ProviderManager] {primary_prov.display_name} failed and auto_fallback is OFF: {primary_error}")
                raise primary_error

            # If auto_fallback is ON, try alternative provider
            alt_pid = "nvidia" if primary_pid == "gemini" else "gemini"
            alt_prov = self.providers[alt_pid]
            alt_model = self.selected_models.get(alt_pid)
            logger.info(f"[ProviderManager] Auto-fallback ON: Attempting {alt_prov.display_name} after {primary_prov.display_name} failure")

            try:
                res = alt_prov.generate(
                    messages=messages,
                    system_instruction=system_instruction,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    model=alt_model,
                    **kwargs
                )
                res.fallback_used = True
                return res
            except Exception as alt_error:
                logger.error(f"[ProviderManager] Both providers failed: primary={primary_error}, alt={alt_error}")
                raise primary_error


# Singleton Global Provider Manager
GLOBAL_PROVIDER_MANAGER = AIProviderManager()
