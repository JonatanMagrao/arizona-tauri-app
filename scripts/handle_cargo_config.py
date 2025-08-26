#!/usr/bin/env python
import re
import sys
from pathlib import Path

# Matches the (optional) comment plus PYO3_CONFIG_FILE line
PATTERN = re.compile(r'^\s*#?\s*PYO3_CONFIG_FILE')
DEFAULT_PATH = (
    Path(__file__).resolve().parent.parent / "src-tauri" / ".cargo" / "config.toml"
)


def toggle_line(line: str, enable: bool) -> str:
    """Comment or uncomment the target line."""
    if not PATTERN.match(line):
        return line

    if enable:  # remove the comment
        return re.sub(r'^\s*#\s*', '', line)
    else:  # add the comment if it is not already there
        return line if line.lstrip().startswith("#") else f"# {line}"


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in ("enable", "disable"):
        print("usage: python toggle_pyo3_config.py [enable|disable] [config.toml]")
        sys.exit(1)

    enable = sys.argv[1] == "enable"
    file_path = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_PATH

    lines = file_path.read_text(encoding="utf-8").splitlines(keepends=True)
    new_lines = [toggle_line(l, enable) for l in lines]
    file_path.write_text("".join(new_lines), encoding="utf-8")

    print(f"✅ {'enabled' if enable else 'disabled'} in {file_path}")


if __name__ == "__main__":
    main()
