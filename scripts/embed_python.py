#!/usr/bin/env python
from pathlib import Path
import subprocess
import sys

# Directories
PYEMBED = Path("src-tauri/target/pyembed")
LIB = PYEMBED / "stdlib" / "site-packages"


def run(cmd: list[str]) -> None:
    subprocess.check_call(cmd)


def main() -> None:
    # 1. Generate PyO3/PyOxidizer artifacts
    run(["pyoxidizer", "generate-python-embedding-artifacts", str(PYEMBED)])

    # 2. Install dependencies into the embedded site‑packages
    run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "-r",
            "requirements.txt",
            "--target",
            str(LIB),
        ]
    )

    print(f"✅ Python stdlib and site‑packages copied to {PYEMBED}")


if __name__ == "__main__":
    main()
