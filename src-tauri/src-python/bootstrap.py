# ================================================================
#  Criado por: Jonatan Magrão
#  Email:      magrao@jonatanmagrao.com.br
#  LinkedIn:   https://www.linkedin.com/in/jonatanmagrao/
#  Instagram:  @nerd_do_after
#
#  Direitos Autorais © 2025 - Todos os direitos reservados
#
#  ⚠️ Este código é fornecido exclusivamente para uso interno
#  da versão enviada por Jonatan Magrão. É proibida a alteração,
#  modificação, redistribuição ou utilização parcial/total sem
#  autorização prévia por escrito do autor.
# ================================================================

from pathlib import Path
import sys

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
