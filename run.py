#!/usr/bin/env python3
"""Run SolvX backend + interactive frontend with one command."""
from pathlib import Path
import json
import subprocess
import threading
import webbrowser

ROOT=Path(__file__).resolve().parent
FRONTEND=ROOT/'frontend'

def start_api():
    import uvicorn
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8080, log_level="info")

def main():
    data_dir=ROOT/'data'
    FRONTEND.mkdir(parents=True,exist_ok=True)
    geom_file = FRONTEND / 'geometry.json'
    if geom_file.exists():
        print('Using existing GEBCO/coast/EEZ geometry cache.')
    else:
        print('Dynamic geometry mode enabled (fetching on demand via /api/geography and /api/bathymetry).')
    threading.Thread(target=start_api,daemon=True).start()

    # Vite resolves npm dependencies (Three.js, MapLibre, Chart.js) through its
    # module graph instead of serving manually copied files from frontend/vendor.
    npm_process = subprocess.Popen(
        ["npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", "5500"],
        cwd=str(ROOT),
    )

    url='http://127.0.0.1:5500/'
    print(f'SolvX frontend (Vite): {url}')
    print('API: http://127.0.0.1:8080/docs')
    def safe_open():
        try:
            # webbrowser.open(url)
            pass
        except Exception:
            pass
    threading.Timer(1.2,safe_open).start()

    try:
        npm_process.wait()
    except KeyboardInterrupt:
        npm_process.terminate()
        try:
            npm_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            npm_process.kill()
if __name__=='__main__':main()
