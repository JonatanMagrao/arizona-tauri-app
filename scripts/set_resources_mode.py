#!/usr/bin/env python
import json
import os
import sys
from argparse import ArgumentParser
from pathlib import Path

DEV = {
    "src-python/": "src-python/",
    "../.venv/Include/": "src-python/.venv/Include/",
    "../.venv/Lib/": "src-python/.venv/Lib/",
}

RELEASE = {
    "src-python/": "src-python/",
    "target/pyembed/python3.dll": "python3.dll",
    "target/pyembed/python310.dll": "python310.dll",
    "target/pyembed/stdlib/": "lib/",
    "target/pyembed/lib": "lib/",
}

CONFIG_PATH = (
    Path(__file__).resolve().parent.parent / "src-tauri" / "tauri.conf.json"
)


def _load_config() -> dict:
    with CONFIG_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def _save_config(cfg: dict, mode: str) -> None:
    with CONFIG_PATH.open("w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
    print(f"✅ tauri.conf.json updated to mode: {mode}")


def set_dev_mode() -> None:
    cfg = _load_config()
    cfg.setdefault("bundle", {})["resources"] = DEV
    _save_config(cfg, "dev")


def set_release_mode() -> None:
    cfg = _load_config()
    cfg.setdefault("bundle", {})["resources"] = RELEASE
    _save_config(cfg, "release")


def main() -> None:
    parser = ArgumentParser(
        description="Update tauri.conf.json resources for DEV or RELEASE."
    )
    parser.add_argument(
        "mode",
        nargs="?",
        choices=("dev", "release"),
        help=(
            "Mode to apply ('dev' or 'release'); "
            "if omitted, falls back to TAURI_APP or 'release'."
        ),
    )
    args = parser.parse_args()

    mode = args.mode or os.getenv("TAURI_APP", "release").lower()

    if mode == "dev":
        set_dev_mode()
    elif mode == "release":
        set_release_mode()
    else:
        print(f"⚠️  Unknown mode: {mode}")
        sys.exit(1)


if __name__ == "__main__":
    main()
