#!/usr/bin/env python
from pathlib import Path

CARGO_DIR  = Path("src-tauri/.cargo")
CONFIG_TOML = CARGO_DIR / "config.toml"

def main() -> None:
    CARGO_DIR.mkdir(parents=True, exist_ok=True)

    CONFIG_TOML.write_text(
        "[env]\n"
        'PYO3_CONFIG_FILE = { value = "target/pyembed/pyo3-build-config-file.txt", relative = true }\n',
        encoding="utf-8"
    )

    print("config.toml created!")

if __name__ == "__main__":
    main()
