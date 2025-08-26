from pathlib import Path
import sys

# https://github.com/PyO3/pyo3/discussions/3726
# sys.path.append(r"E:\local_code_folders\tauri_app_test\thumbnail\.venv\Lib\site-packages")

# code below provided with chatgpt


def load_site_packages_from_venv(base_path: Path) -> None:
    site_pkgs = base_path.parent / ".venv" / "Lib" / "site-packages"
    if site_pkgs.exists():
        sys.path.append(str(site_pkgs))


def load_site_packages_from_release(base_path: Path) -> None:
    release_root = base_path.parent.parent / "target" / "release"
    site_pkgs = release_root / "lib" / "site-packages"
    if release_root.exists():
        sys.path.insert(0, str(release_root))
    if site_pkgs.exists():
        sys.path.insert(0, str(site_pkgs))


base_path = Path(sys.argv[0]).resolve()
release_path = base_path.parent.parent / "target" / "release"

if release_path.exists():
    load_site_packages_from_release(base_path)
else:
    load_site_packages_from_venv(base_path)
