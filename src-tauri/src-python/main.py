# -*- coding: utf-8 -*-
import bootstrap
from arizona import Arizona

_tauri_plugin_functions = [
  "openVisto",
  "openBitrix",
  "openPip",
  "openClaro",
  "openLinks",
  "openJobao",
  "openJobinho",
  "abrirAE",
  "openRender"
]

ARIZONA = Arizona(2025)

def _ok(msg=None):     return {"ok": True,  "message": msg}
def _err(msg):         return {"ok": False, "message": msg or "Ocorreu um erro."}

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
    ARIZONA.open_visto(); ARIZONA.open_bitrix(); ARIZONA.open_pip()
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
    return _err(str(e))

def openJobinho(jobao_cod, jobinho_cod):
  path = ARIZONA.get_jobao_path(jobao_cod)
  if not path:
    return _err(f'Jobão "{jobao_cod or "(vazio)"}" não encontrado.')
  try:
    ARIZONA.open_jobinhos_folder(jobao_cod, jobinho_cod)
    return _ok()
  except Exception as e:
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
    return _err(str(e))

def openRender(jobao_cod, formato):
  path = ARIZONA.get_jobao_path(jobao_cod)
  if not path:
    return _err(f'Jobão "{jobao_cod or "(vazio)"}" não encontrado.')
  try:
    ARIZONA.open_render(jobao_cod, formato)
    return _ok()
  except Exception as e:
    return _err(str(e))
