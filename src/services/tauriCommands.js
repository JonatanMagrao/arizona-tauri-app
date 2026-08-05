import { invoke } from "@tauri-apps/api/core";

export const commandNames = Object.freeze({
  abrirAe: "abrir_ae",
  afterEffectsActionCommand: "after_effects_action_command",
  appInfo: "app_info",
  authActivate: "auth_activate",
  authPoll: "auth_poll",
  authResume: "auth_resume",
  cepBridgeStatus: "cep_bridge_status",
  cepDebugModeStatus: "cep_debug_mode_status",
  cepExtensionStatus: "cep_extension_status",
  clearSecureAuth: "clear_secure_auth",
  duplicateIdenticalMp4: "duplicate_identical_mp4",
  exportIdenticalMp4NamesJson: "export_identical_mp4_names_json",
  exitApp: "exit_app",
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
  importIdenticalMp4NamesJson: "import_identical_mp4_names_json",
  inspectCepZxp: "inspect_cep_zxp",
  installCepZxp: "install_cep_zxp",
  listIdenticalMp4Items: "list_identical_mp4_items",
  listInstalledAfterEffectsVersions: "list_installed_after_effects_versions",
  loadAppConfig: "load_app_config",
  openBitrix: "open_bitrix",
  openClaro: "open_claro",
  openAuthorSite: "open_author_site",
  closeSecondaryWindow: "close_secondary_window",
  openDuplicateIdenticalWindow: "open_duplicate_identical_window",
  openAudio: "open_audio",
  openJobao: "open_jobao",
  openJobinho: "open_jobinho",
  openLinks: "open_links",
  openMediaNative: "open_media_native",
  openOut: "open_out",
  openPip: "open_pip",
  openRoteiro: "open_roteiro",
  openSecondaryWindow: "open_secondary_window",
  openVideo: "open_video",
  openVisto: "open_visto",
  projectName: "project_name",
  revealVideo: "reveal_video",
  restrictAdminSession: "restrict_admin_session",
  adminListMembers: "admin_list_members",
  adminAddMember: "admin_add_member",
  adminReleaseDevice: "admin_release_device",
  adminRemoveMember: "admin_remove_member",
  adminGenerateActivationCode: "admin_generate_activation_code",
  releaseCurrentDevice: "release_current_device",
  saveAppConfig: "save_app_config",
  setAfterShortcutRecording: "set_after_shortcut_recording",
  setCepDebugMode: "set_cep_debug_mode",
  updateIdenticalMp4NamesJson: "update_identical_mp4_names_json",
});

export function invokeCommand(commandName, args = {}) {
  return invoke(commandName, args);
}

export async function invokeAction(commandName, args = {}, fallbackMessage = "Falha ao executar ação.") {
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
      message: fallbackMessage || String(error || "Falha ao executar ação."),
      error,
    };
  }
}
