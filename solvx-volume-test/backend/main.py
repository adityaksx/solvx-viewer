"""
FastAPI Main Application for SolvX Volume Renderer Test Prototype.
"""

from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .routes import router

from fastapi import Response

app = FastAPI(
    title="SolvX Three.js Volume Renderer Test",
    description="Standalone testing prototype coupling SolvX NetCDF data with Three.js ray-marching volume rendering",
    version="1.0.0"
)

# Enable CORS for local testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(router)

@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)


# Mount static frontend directory
BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
WORKSPACE_DIR = BASE_DIR.parent
NODE_MODULES_DIR = WORKSPACE_DIR / "node_modules"

if NODE_MODULES_DIR.exists():
    app.mount("/node_modules", StaticFiles(directory=NODE_MODULES_DIR), name="node_modules")

if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("solvx-volume-test.backend.main:app", host="0.0.0.0", port=8055, reload=True)
