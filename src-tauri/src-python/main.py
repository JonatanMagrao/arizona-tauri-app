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

# -*- coding: utf-8 -*-
import bootstrap
from log_txt import (create_temp_log, append_produtos_log)
from arizona import Arizona
from config import CONFIG
from pathlib import Path
import tempfile
import os
import re

_tauri_plugin_functions = [
    "openVisto",
    "openBitrix",
    "openPip",
    "openClaro",
    "openLinks",
    "openJobao",
    "openJobinho",
    "abrirAE",
    "openOut",
    "importProducts",
    "openVideo",
    "openRoteiro",
    "openLogFile",
    "projectName"
]

ARIZONA = Arizona(CONFIG)


def _ok(msg=None): return {"ok": True,  "message": msg}
def _err(msg): return {"ok": False, "message": msg or "Ocorreu um erro."}


def openVisto():
    try:
        ARIZONA.open_visto()
        return _ok()
    except Exception as e:
        return _err(str(e))


def openBitrix():
    try:
        ARIZONA.open_bitrix()
        return _ok()
    except Exception as e:
        return _err(str(e))


def openPip():
    try:
        ARIZONA.open_pip()
        return _ok()
    except Exception as e:
        return _err(str(e))


def openClaro():
    try:
        ARIZONA.open_claro()
        return _ok()
    except Exception as e:
        return _err(str(e))


def openLinks():
    try:
        ARIZONA.open_visto()
        ARIZONA.open_bitrix()
        ARIZONA.open_pip()
        return _ok()
    except Exception as e:
        return _err(str(e))


def openJobao(jobao_cod):
    path = ARIZONA.get_jobao_path(jobao_cod)
    if not path:
        return _err(f'Jobão "{jobao_cod or "(vazio)"}" não encontrado.')
    try:
        ARIZONA.open_jobao(jobao_cod)
        return _ok()
    except Exception as e:
        print(e)
        return _err(str(e))


def openJobinho(jobao_cod, jobinho_cod):
    path = ARIZONA.get_jobao_path(jobao_cod)
    if not path:
        return _err(f'Jobão "{jobao_cod or "(vazio)"}" não encontrado.')
    try:
        ARIZONA.open_jobinhos_folder(jobao_cod, jobinho_cod)
        return _ok()
    except Exception as e:
        print(e)
        return _err(str(e))


def abrirAE(jobao_cod, jobinho_cod):
    path = ARIZONA.get_jobao_path(jobao_cod)
    if not path:
        return _err(f'Jobão "{jobao_cod or "(vazio)"}" não encontrado.')
    try:
        ok = ARIZONA.abrir_jobinho(jobao_cod, jobinho_cod)
        if ok is False:
            return _err(f'Código Jobinho "{jobinho_cod}" inválido.')
        return _ok()
    except Exception as e:
        print(e)
        return _err(str(e))


def openOut(jobao_cod, option):
    path = ARIZONA.get_jobao_path(jobao_cod)
    if not path:
        return _err(f'Jobão "{jobao_cod or "(vazio)"}" não encontrado.')
    try:
        ARIZONA.open_out(jobao_cod, option)
        return _ok()
    except Exception as e:
        return _err(str(e))


def importProducts(jobao_cod):
    product_path, linhas_visiveis = ARIZONA.get_visible_rows_from_xl(jobao_cod)

    try:
        # listas para consolidar resultados
        imported_normais = []
        not_found_normais = []
        grupos_resultados = []

        # separar linhas com ";" (grupos) e sem (soltos)
        linhas_soltas = []
        linhas_com_grupo = []
        for linha in linhas_visiveis:
            if ";" in linha:
                linhas_com_grupo.append(linha)
            else:
                linhas_soltas.append(linha)

        # 1) processa códigos soltos
        codigos_soltos = [linha.split(".")[0].strip()
                          for linha in linhas_soltas if linha.strip()]
        if codigos_soltos:
            res = ARIZONA.importar_produtos(product_path, codigos_soltos)
            imported_normais.extend(res["imported_files"])
            not_found_normais.extend(res["not_found_files"])

        # 2) processa grupos no final
        for idx, linha in enumerate(linhas_com_grupo, start=1):
            partes = [p.strip().split(".")[0]
                      for p in linha.split(";") if p.strip()]
            subpasta = Path(product_path) / f"produtos_{idx:02d}"
            subpasta.mkdir(parents=True, exist_ok=True)

            res = ARIZONA.importar_produtos(subpasta, partes)

            grupos_resultados.append({
                "nome_pasta": f"produtos_{idx:02d}",
                "imported_files": res["imported_files"],
                "not_found_files": res["not_found_files"]
            })

        # 3) monta log consolidado
        log_path = create_temp_log()
        with open(log_path, "w", encoding="utf-8") as logf:
            # resumo geral
            total_processados = len(codigos_soltos) + sum(
                len(g["imported_files"]) + len(g["not_found_files"]) for g in grupos_resultados
            )
            total_importados = len(
                imported_normais) + sum(len(g["imported_files"]) for g in grupos_resultados)
            total_nao_encontrados = len(
                not_found_normais) + sum(len(g["not_found_files"]) for g in grupos_resultados)

            logf.write("=== Resumo Geral ===\n")
            logf.write(f"Total de códigos processados: {total_processados}\n")
            logf.write(f"Importados: {total_importados}\n")
            logf.write(f"Não encontrados: {total_nao_encontrados}\n")
            logf.write(f"Grupos detectados: {len(grupos_resultados)}\n\n")

            # não encontrados (repetidos logo no início)
            logf.write("=== Produtos Não Encontrados ===\n")
            for f in not_found_normais:
                logf.write(f"❌ {f}\n")
            for g in grupos_resultados:
                for nf in g["not_found_files"]:
                    logf.write(f"❌ {nf}\n")
            logf.write("\n")

            # importados normais
            logf.write("=== Produtos Importados ===\n")
            for f in imported_normais:
                logf.write(f"✅ {f}\n")
            for nf in not_found_normais:
                logf.write(f"❌ {nf}\n")
            logf.write("\n")

            # grupos em formato árvore
            if grupos_resultados:
                logf.write("=== Grupos ===\n\n")
                for g in grupos_resultados:
                    logf.write(f"{g['nome_pasta']}\n")
                    todos = [(f, True) for f in g["imported_files"]] + \
                        [(f, False) for f in g["not_found_files"]]
                    for i, (f, ok) in enumerate(todos):
                        prefix = " ┣ " if i < len(todos) - 1 else " ┗ "
                        mark = "✅" if ok else "❌"
                        logf.write(f"{prefix}{mark} {f}\n")
                    logf.write("\n")

        os.startfile(log_path)
        return _ok()

    except Exception as e:
        return _err(str(e))


def openRoteiro(jobao_cod, cod_jobinho):
    jobao = ARIZONA.get_jobao_path(jobao_cod)

    if not jobao:
        return _err(f'Jobão "{jobao_cod or "(vazio)"}" não encontrado.')

    roteiros = Path(jobao) / "ROTEIRO" / "LOCUCAO"
    jobinho = Path(jobao) / "PROJETOS" / "AE"
    praca = None
    roteiro = None

    for job in jobinho.iterdir():
        if re.match(cod_jobinho, job.name):
            praca = job.name.split("_")[1]
            break

    for rot in roteiros.iterdir():
        decupado = rot.stem.split("_")
        if praca in decupado:
            roteiro = rot
            break

    if praca is None:
        print(f"Praça não encontrada.")
        return _err("Praça não encontrada.")

    if roteiro is None:
        print(f"Roteiro do '{praca}' não encontrado.")
        return _err("Roteiro não encontrado.")

    os.startfile(roteiro)


def openVideo(jobao_cod, cod_jobinho, media_type="mp4"):
    jobao = ARIZONA.get_jobao_path(jobao_cod)

    if not jobao:
        return _err(f'Jobão "{jobao_cod or "(vazio)"}" não encontrado.')

    pasta = "MP4" if media_type == "mp4" else "MOV"
    videos = Path(jobao) / "OUT" / "RENDER" / pasta

    jobinho = Path(jobao) / "PROJETOS" / "AE"
    video = None
    praca = None

    for job in jobinho.iterdir():
        if re.match(cod_jobinho, job.name):
            praca = job.stem
            break

    for vid in videos.iterdir():
        if re.match(praca, vid.stem):
            video = vid
            break

    if praca is None:
        print(f"Praça não encontrada.")
        return _err("Praça não encontrada.")

    if video is None:
        print(f"Roteiro do '{praca}' não encontrado.")
        return _err("Roteiro não encontrado.")

    os.startfile(video)


def openLogFile():
    log_path = Path(tempfile.gettempdir()) / "produtos-log.txt"

    if not log_path.exists():
        raise FileNotFoundError(f"Log não encontrado em {log_path}")

    os.startfile(str(log_path))


def projectName(jobao_cod, jobinho_cod):
    jobao = ARIZONA.get_jobao_path(jobao_cod)

    if not jobao:
        return _err(f'Jobão "{jobao_cod or "(vazio)"}" não encontrado.')

    jobinho = Path(jobao) / "PROJETOS" / "AE"
    for job in jobinho.iterdir():
       if re.match(jobinho_cod, job.name):
        praca_code = job.name.split("_")[1].strip().lower()
        praca_nome = PRACAS.get(praca_code, praca_code)  # pega da tabela; se não houver, mantém o código
        return _ok(praca_nome)


PRACAS = {
    "cur": "Curitiba",
    "df": "Distrito Federal",
    "bh": "Belo Horizonte",
    "rj": "Rio de Janeiro",
    "am": "Amazonas",
    "poa": "POA",
    "pe": "Pernambuco",
    "lon": "Londrina",
    "sc": "Santa Catarina",
    "jfo": "JFO",
    "ubl": "UBL",
    "cg": "CG",
    "bcg": "BCG",
    "es": "Espírito Santo",
    "go": "Goiás",
    "rs-int": "Rio Grande do Sul",
    "al": "Alagoas",
    "pb": "Paraíba",
    "rn": "Rio Grande do Norte",
    "sp2": "São Paulo",
    "camp": "Campinas",
    "srjppp": "SRJPPP",

}

if __name__ == "__main__":
    # importProducts("895")
    # openRoteiro("895","15193")
    # openVideo("895","15193")
    # openLogFile()
    print(projectName("895", "15180"))
