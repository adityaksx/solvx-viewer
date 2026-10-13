#!/usr/bin/env python3
"""Run SolvX backend + interactive frontend with one command."""
from pathlib import Path
import os
import shutil
import subprocess
import threading
import time
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"


def start_api():
    import uvicorn
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8080, log_level="info")


def start_frontend():
    """Launch Vite using the npm executable available on the current OS."""
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm:
        raise RuntimeError(
            "npm was not found on PATH. Install Node.js (which includes npm), "
            "then restart your terminal and try again."
        )

    args = [
        "run", "dev", "--",
        "--host", "127.0.0.1",
        "--port", "5500",
    ]

    # Windows npm installations expose npm.cmd, which must be launched via
    # cmd.exe. Unix-like systems expose npm as an executable and need no shell.
    if os.name == "nt" and npm.lower().endswith((".cmd", ".bat")):
        command = ["cmd.exe", "/d", "/s", "/c", subprocess.list2cmdline([npm, *args])]
    else:
        command = [npm, *args]

    return subprocess.Popen(command, cwd=str(ROOT))


def main():
    FRONTEND.mkdir(parents=True, exist_ok=True)
    geom_file = FRONTEND / "geometry.json"
    if geom_file.exists():
        print("Using existing GEBCO/coast/EEZ geometry cache.")
    else:
        print("Dynamic geometry mode enabled (fetching on demand via /api/geography and /api/bathymetry).")

    api_thread = threading.Thread(target=start_api, daemon=True, name="solvx-api")
    api_thread.start()

    # Do not expose the frontend until FastAPI is actually ready. The backend
    # performs scientific-data cache warmup in the background after readiness.
    health_url = "http://127.0.0.1:8080/health"
    print("Starting SolvX API...")
    for _ in range(60):
        try:
            with urllib.request.urlopen(health_url, timeout=1) as response:
                if response.status == 200:
                    print("SolvX API is ready.")
                    break
        except Exception:
            time.sleep(0.25)
    else:
        raise RuntimeError("SolvX API did not become ready on http://127.0.0.1:8080")

    # Vite resolves npm dependencies (Three.js, MapLibre, Chart.js) through its
    # module graph instead of serving manually copied files from frontend/vendor.
    npm_process = start_frontend()

    url = "http://127.0.0.1:5500/"
    print(f"SolvX frontend (Vite): {url}")
    print("API: http://127.0.0.1:8080/docs")

    def safe_open():
        try:
            # webbrowser.open(url)
            pass
        except Exception:
            pass

    threading.Timer(1.2, safe_open).start()

    try:
        npm_process.wait()
    except KeyboardInterrupt:
        npm_process.terminate()
        try:
            npm_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            npm_process.kill()


if __name__ == "__main__":
    main()
