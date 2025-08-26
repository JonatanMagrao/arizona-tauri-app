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
  "abrirAE"
]

ARIZONA = Arizona(2025)


def openVisto():
  ARIZONA.open_visto()

def openBitrix():
  ARIZONA.open_bitrix()

def openPip():
  ARIZONA.open_pip()  

def openClaro():
  ARIZONA.open_claro()

def openLinks():
  ARIZONA.open_visto()
  ARIZONA.open_bitrix()
  ARIZONA.open_pip()

def openJobao(jobao_cod):
  ARIZONA.get_jobao_path(jobao_cod)
  ARIZONA.open_jobao(jobao_cod)

def openJobinho(jobao_cod,jobinho_cod):
  ARIZONA.get_jobao_path(jobao_cod)
  ARIZONA.open_jobinhos_folder(jobao_cod,jobinho_cod)

def abrirAE(jobao_cod,jobinho_cod):
  ARIZONA.get_jobao_path(jobao_cod)
  ARIZONA.abrir_jobinho(jobao_cod,jobinho_cod)