from pathlib import Path
import tempfile, os

def create_temp_log() -> Path:
    """
    Cria (ou abre) um arquivo de log na pasta temp do usuário.
    Retorna o Path do arquivo.
    """
    temp_dir = Path(tempfile.gettempdir())
    log_path = temp_dir / "produtos-log.txt"

    with open(log_path, "w", encoding="utf-8") as f:
        f.write("=== Log de Produtos ===\n")

    return log_path


def append_produtos_log(log_path: Path, dados: dict) -> None:
    """Acrescenta dados ao log com ✅ e ❌, incluindo resumo no topo."""
    imported = len(dados.get("imported_files", []))
    not_found = len(dados.get("not_found_files", []))
    total = dados.get("total_files", 0)

    with open(log_path, "a", encoding="utf-8") as f:
        # Header com resumo
        f.write("\n=== Resumo ===\n")
        f.write(f"Total de códigos processados: {total-1}\n")
        # f.write(f"✅ Copiados: {imported}\n")
        f.write(f"❌ Não encontrados: {not_found}\n")

        # Lista de não encontrados
        f.write("\n=== Produtos Não Encontrados ===\n")
        for item in dados.get("not_found_files", []):
            f.write(f"❌ {item}\n")

        # Lista de importados
        f.write("\n=== Produtos Importados ===\n")
        for item in dados.get("imported_files", []):
            f.write(f"✅ {item}\n")
