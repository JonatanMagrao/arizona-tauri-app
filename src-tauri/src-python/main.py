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
from arizona import Arizona
from config import CONFIG

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
    "importProducts"
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
    product_path, product_list = ARIZONA.images_list_from_xl(jobao_cod)

    try:
        resultado = ARIZONA.importar_produtos(product_path, product_list)
        return _ok()
    except Exception as e:
        return _err(str(e))


if __name__ == "__main__":
    importProducts("895")