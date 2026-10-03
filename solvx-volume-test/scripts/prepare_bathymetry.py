#!/usr/bin/env python3
"""
Links or copies frontend/geometry.json to solvx-volume-test/data/geometry/geometry.json
"""
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
TARGET_DIR = BASE_DIR / "data" / "geometry"
SOURCE_GEOM = BASE_DIR.parent / "frontend" / "geometry.json"

def main():
    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    target_file = TARGET_DIR / "geometry.json"
    if not SOURCE_GEOM.exists():
        print(f"Warning: Source geometry {SOURCE_GEOM} not found!")
        return

    if not target_file.exists():
        try:
            target_file.symlink_to(SOURCE_GEOM)
            print(f"Symlinked {SOURCE_GEOM} -> {target_file}")
        except OSError:
            shutil.copy2(SOURCE_GEOM, target_file)
            print(f"Copied {SOURCE_GEOM} -> {target_file}")
    else:
        print(f"Geometry already exists at {target_file}")

if __name__ == "__main__":
    main()
