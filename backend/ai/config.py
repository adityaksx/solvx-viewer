"""
SolvX — AI Multi-Provider & Model Configuration
================================================
Central configuration for Google Gemini and NVIDIA NIM providers,
default settings, model catalogs, and persistence paths.
"""

import os
from pathlib import Path
from typing import List, Dict, Any

# Root Data Directory for persistent settings
BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
AI_SETTINGS_FILE = DATA_DIR / "ai_settings.json"

# =============================================================================
# Provider Defaults
# =============================================================================

DEFAULT_AI_PROVIDER: str = os.getenv("AI_PROVIDER", "gemini").strip().lower()
AUTO_PROVIDER_FALLBACK: bool = os.getenv("AUTO_PROVIDER_FALLBACK", "false").strip().lower() in ("1", "true", "yes")

# =============================================================================
# Google Gemini Configuration
# =============================================================================

GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "").strip()
DEFAULT_GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-3.8-flash").strip()

GEMINI_MODEL_CATALOG: List[Dict[str, str]] = [
    {"id": "gemini-3.8-flash", "name": "Gemini 3.8 Flash", "description": "Recommended: Latest fast multimodal reasoning & low latency"},
    {"id": "gemini-3.8-pro", "name": "Gemini 3.8 Pro", "description": "Latest flagship: Deep scientific reasoning & physics synthesis"},
    {"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash", "description": "High-throughput ocean intelligence"},
    {"id": "gemini-2.5-flash-lite", "name": "Gemini 2.5 Flash-Lite", "description": "Ultra low-cost explanation model"},
    {"id": "gemini-1.5-flash", "name": "Gemini 1.5 Flash", "description": "Low latency operational model"}
]



# =============================================================================
# NVIDIA NIM Configuration
# =============================================================================

NVIDIA_BASE_URL: str = os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1").rstrip("/")
NVIDIA_API_KEY: str = os.getenv("NVIDIA_API_KEY", "").strip()
DEFAULT_NVIDIA_MODEL: str = os.getenv("NVIDIA_PRIMARY_MODEL", os.getenv("NVIDIA_MODEL", "deepseek-ai/deepseek-v4.1-flash")).strip()

NVIDIA_MODEL_CATALOG: List[Dict[str, str]] = [
    {"id": "deepseek-ai/deepseek-v4.1-flash", "name": "DeepSeek V4.1 Flash", "description": "High-throughput reasoning"},
    {"id": "moonshotai/kimi-k3", "name": "Kimi K3", "description": "Long-context scientific analysis"},
    {"id": "z-ai/glm-5-3-flash", "name": "GLM 5.3 Flash", "description": "Fast multimodal ocean reasoning"},
    {"id": "nvidia/nemotron-3.5-lightning-30b-a3b", "name": "Nemotron 3.5 Lightning", "description": "NVIDIA optimized physics model"},
    {"id": "google/gemma-4-31b-it", "name": "Gemma 4 31B", "description": "High parameter open weights"},
    {"id": "openai/gpt-oss-20b", "name": "GPT OSS 20B", "description": "General ocean reasoning"}
]

NVIDIA_MODEL_PRIORITY: List[str] = [m["id"] for m in NVIDIA_MODEL_CATALOG]

# Ensure default NVIDIA model is at index 0
if DEFAULT_NVIDIA_MODEL in NVIDIA_MODEL_PRIORITY:
    NVIDIA_MODEL_PRIORITY.remove(DEFAULT_NVIDIA_MODEL)
    NVIDIA_MODEL_PRIORITY.insert(0, DEFAULT_NVIDIA_MODEL)

NVIDIA_PRIMARY_MODEL: str = DEFAULT_NVIDIA_MODEL
GEMINI_PRIMARY_MODEL: str = DEFAULT_GEMINI_MODEL
GEMINI_MODELS: List[str] = [m["id"] for m in GEMINI_MODEL_CATALOG]
NVIDIA_MODELS: List[str] = [m["id"] for m in NVIDIA_MODEL_CATALOG]

# Network and Performance Configuration
NVIDIA_REQUEST_TIMEOUT: float = float(os.getenv("NVIDIA_REQUEST_TIMEOUT", "20.0"))
GEMINI_REQUEST_TIMEOUT: float = float(os.getenv("GEMINI_REQUEST_TIMEOUT", "20.0"))
NVIDIA_MAX_RETRIES: int = int(os.getenv("NVIDIA_MAX_RETRIES", "2"))
NVIDIA_CACHE_TTL_SECONDS: int = int(os.getenv("NVIDIA_CACHE_TTL_SECONDS", "300"))

