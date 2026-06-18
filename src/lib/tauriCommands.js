import { invoke } from "@tauri-apps/api/core";

export const commandNames = Object.freeze({
  abrirAe: "abrir_ae",
  duplicateIdenticalMp4: "duplicate_identical_mp4",
  historyClear: "history_clear",
  historyCopyClear: "history_copy_clear",
  historyCopyList: "history_copy_list",
  historyCopyOpenFolder: "history_copy_open_folder",
  historyCopyOpenMedia: "history_copy_open_media",
  historyCopyRevealMedia: "history_copy_reveal_media",
  historyList: "history_list",
  historyOpenAfterProject: "history_open_after_project",
  historyOpenJobaoFolder: "history_open_jobao_folder",
  historyOpenMedia: "history_open_media",
  historyProductImportClear: "history_product_import_clear",
  historyProductImportList: "history_product_import_list",
  historyRefreshAllEntries: "history_refresh_all_entries",
  historyRefreshEntry: "history_refresh_entry",
  historyRevealAfterProject: "history_reveal_after_project",
  historyRevealMedia: "history_reveal_media",
  importProducts: "import_products",
  listIdenticalMp4Items: "list_identical_mp4_items",
  loadAppConfig: "load_app_config",
  openBitrix: "open_bitrix",
  openClaro: "open_claro",
  closeSecondaryWindow: "close_secondary_window",
  openDuplicateIdenticalWindow: "open_duplicate_identical_window",
  openAudio: "open_audio",
  openJobao: "open_jobao",
  openJobinho: "open_jobinho",
  openLinks: "open_links",
  openLogFile: "open_log_file",
  openMediaNative: "open_media_native",
  openOut: "open_out",
  openPip: "open_pip",
  openRoteiro: "open_roteiro",
  openSecondaryWindow: "open_secondary_window",
  openVideo: "open_video",
  openVisto: "open_visto",
  projectName: "project_name",
  revealVideo: "reveal_video",
  saveAppConfig: "save_app_config",
});

export function invokeCommand(commandName, args = {}) {
  return invoke(commandName, args);
}

export async function invokeAction(commandName, args = {}, fallbackMessage = "Falha ao executar acao.") {
  try {
    const response = await invokeCommand(commandName, args);

    if (response?.ok === false) {
      return {
        ok: false,
        message: response.message || fallbackMessage,
        response,
      };
    }

    return { ok: true, response };
  } catch (error) {
    return {
      ok: false,
      message: fallbackMessage || String(error || "Falha ao executar acao."),
      error,
    };
  }
}
