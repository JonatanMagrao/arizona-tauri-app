import { invoke } from "@tauri-apps/api/core";
import { publicErrorMessage } from "../utils/publicErrors";

export const commandNames = Object.freeze({
  abrirAe: "abrir_ae",
  afterEffectsActionCommand: "after_effects_action_command",
  appInfo: "app_info",
  authActivate: "auth_activate",
  authCurrentSession: "auth_current_session",
  authPoll: "auth_poll",
  authResume: "auth_resume",
  cepBridgeStatus: "cep_bridge_status",
  cepDebugModeStatus: "cep_debug_mode_status",
  cepExtensionStatus: "cep_extension_status",
  clearSecureAuth: "clear_secure_auth",
  duplicateIdenticalMp4: "duplicate_identical_mp4",
  diagnosticsExport: "diagnostics_export",
  diagnosticsOpenDirectory: "diagnostics_open_directory",
  diagnosticsRecordEvent: "diagnostics_record_event",
  diagnosticsSetDirectory: "diagnostics_set_directory",
  diagnosticsStatus: "diagnostics_status",
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
  openRoteiroInWord: "open_roteiro_in_word",
  viewRoteiro: "view_roteiro",
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

const DIAGNOSTIC_ACTIONS = Object.freeze({
  [commandNames.clearSecureAuth]: ["acesso", "sair", "Encerrando o acesso salvo neste computador."],
  [commandNames.releaseCurrentDevice]: ["acesso", "liberar_dispositivo", "Liberando este computador."],
  [commandNames.abrirAe]: ["after_effects", "abrir_projeto", "Abrindo o projeto no After Effects."],
  [commandNames.openJobao]: ["projetos", "abrir_jobao", "Abrindo a pasta do Jobão."],
  [commandNames.openJobinho]: ["projetos", "abrir_jobinho", "Abrindo a pasta do Jobinho."],
  [commandNames.openOut]: ["projetos", "abrir_saida", "Abrindo a pasta de saída."],
  [commandNames.openRoteiro]: ["roteiro", "abrir_roteiro", "Abrindo o roteiro."],
  [commandNames.openRoteiroInWord]: ["roteiro", "abrir_no_word", "Abrindo o roteiro no Word."],
  [commandNames.viewRoteiro]: ["roteiro", "visualizar", "Preparando a visualização do roteiro."],
  [commandNames.importProducts]: ["produtos", "importar", "Importando os produtos do Jobão."],
  [commandNames.duplicateIdenticalMp4]: ["produtos", "duplicar_identicos", "Duplicando os produtos idênticos."],
  [commandNames.exportIdenticalMp4NamesJson]: ["produtos", "exportar_mapeamento", "Exportando o mapeamento de produtos idênticos."],
  [commandNames.importIdenticalMp4NamesJson]: ["produtos", "importar_mapeamento", "Importando o mapeamento de produtos idênticos."],
  [commandNames.updateIdenticalMp4NamesJson]: ["produtos", "atualizar_mapeamento", "Atualizando o mapeamento de produtos idênticos."],
  [commandNames.saveAppConfig]: ["configuracoes", "salvar", "Salvando as configurações do aplicativo."],
  [commandNames.installCepZxp]: ["extensao", "instalar", "Instalando o painel do After Effects."],
  [commandNames.setCepDebugMode]: ["extensao", "alterar_depuracao", "Alterando as opções de diagnóstico do painel."],
  [commandNames.adminAddMember]: ["gestao", "adicionar_usuario", "Adicionando um usuário à licença."],
  [commandNames.adminReleaseDevice]: ["gestao", "liberar_dispositivo", "Liberando o computador de um usuário."],
  [commandNames.adminRemoveMember]: ["gestao", "remover_usuario", "Removendo um usuário da licença."],
  [commandNames.adminGenerateActivationCode]: ["gestao", "gerar_codigo", "Gerando um código de ativação."],
  [commandNames.historyClear]: ["historico", "limpar_projetos", "Limpando o histórico de projetos."],
  [commandNames.historyCopyClear]: ["historico", "limpar_copias", "Limpando o histórico de cópias."],
  [commandNames.historyProductImportClear]: ["historico", "limpar_importacoes", "Limpando o histórico de importações."],
});

const CORE_DIAGNOSTIC_COMMANDS = new Set([
  commandNames.afterEffectsActionCommand,
  commandNames.authActivate,
  commandNames.authPoll,
  commandNames.authResume,
  commandNames.cepBridgeStatus,
]);

export async function invokeCommand(commandName, args = {}) {
  const diagnosticAction = DIAGNOSTIC_ACTIONS[commandName];
  const startedAt = Date.now();

  if (diagnosticAction) {
    recordLocalDiagnostic({
      level: "info",
      component: diagnosticAction[0],
      action: diagnosticAction[1],
      status: "started",
      message: diagnosticAction[2],
    });
  }

  try {
    if (commandName === commandNames.exitApp) {
      await waitForLocalDiagnostics(1000);
    }
    const response = await invoke(commandName, args);
    const responseFailure = CORE_DIAGNOSTIC_COMMANDS.has(commandName)
      ? null
      : diagnosticResponseFailure(response);
    if (diagnosticAction || responseFailure) {
      const component = diagnosticAction?.[0] || "aplicativo";
      const action = diagnosticAction?.[1] || commandName;
      recordLocalDiagnostic({
        level: responseFailure ? "error" : "info",
        component,
        action,
        status: responseFailure ? "failed" : "completed",
        code: responseFailure?.code,
        message: responseFailure
          ? `O Arizona não conseguiu concluir: ${humanActionName(diagnosticAction)}.`
          : `O Arizona concluiu: ${humanActionName(diagnosticAction)}.`,
        details: {
          durationMs: Date.now() - startedAt,
          ...(responseFailure?.message
            ? { technicalMessage: responseFailure.message }
            : {}),
        },
      });
    }
    return response;
  } catch (error) {
    const component = diagnosticAction?.[0] || "aplicativo";
    const action = diagnosticAction?.[1] || commandName;
    recordLocalDiagnostic({
      level: "error",
      component,
      action,
      status: "failed",
      code: errorCode(error) || "tauri_command_failed",
      message: `O Arizona não conseguiu concluir: ${humanActionName(diagnosticAction)}.`,
      details: {
        durationMs: Date.now() - startedAt,
        technicalMessage: errorMessage(error),
      },
    });
    throw error;
  }
}

export async function invokeAction(commandName, args = {}, fallbackMessage = "Não foi possível concluir esta ação.") {
  try {
    const response = await invokeCommand(commandName, args);

    if (response?.ok === false) {
      return {
        ok: false,
        message: publicErrorMessage(response.message, fallbackMessage),
        response,
      };
    }

    return { ok: true, response };
  } catch (error) {
    return {
      ok: false,
      message: publicErrorMessage(error, fallbackMessage || "Não foi possível concluir esta ação."),
      error,
    };
  }
}

const LOCAL_DIAGNOSTIC_QUEUE_CAPACITY = 512;
const pendingLocalDiagnostics = [];
let localDiagnosticInFlight = false;

export function recordLocalDiagnostic(event) {
  if (pendingLocalDiagnostics.length >= LOCAL_DIAGNOSTIC_QUEUE_CAPACITY) {
    pendingLocalDiagnostics.shift();
  }
  pendingLocalDiagnostics.push({
    source: "tauri-ui",
    ...event,
  });
  flushNextLocalDiagnostic();
}

function flushNextLocalDiagnostic() {
  if (localDiagnosticInFlight) return;
  const event = pendingLocalDiagnostics.shift();
  if (!event) return;
  localDiagnosticInFlight = true;

  const completed = () => {
    localDiagnosticInFlight = false;
    flushNextLocalDiagnostic();
  };
  try {
    Promise.resolve(invoke(commandNames.diagnosticsRecordEvent, { event }))
      .then(completed, completed);
  } catch {
    completed();
  }
}

async function waitForLocalDiagnostics(timeoutMs) {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  while (
    (localDiagnosticInFlight || pendingLocalDiagnostics.length > 0)
    && Date.now() < deadline
  ) {
    await new Promise((resolve) => window.setTimeout(resolve, 10));
  }
}

let diagnosticsInitialized = false;

export function initTauriDiagnostics() {
  if (diagnosticsInitialized || typeof window === "undefined") return;
  diagnosticsInitialized = true;

  window.addEventListener("error", (event) => {
    void recordLocalDiagnostic({
      level: "error",
      component: "interface",
      action: "erro_nao_tratado",
      status: "failed",
      code: "tauri_ui_unhandled_error",
      message: "A interface do Arizona parou de funcionar como esperado durante uma ação.",
      details: { technicalMessage: event.message || "Erro sem mensagem." },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    void recordLocalDiagnostic({
      level: "error",
      component: "interface",
      action: "promessa_nao_tratada",
      status: "failed",
      code: "tauri_ui_unhandled_rejection",
      message: "Uma ação da interface foi interrompida antes de terminar.",
      details: { technicalMessage: errorMessage(event.reason) },
    });
  });
}

function diagnosticResponseFailure(response) {
  if (!response || typeof response !== "object") return null;
  const failed = response.ok === false
    || response.state === "error"
    || response.status === "error";
  if (!failed) return null;

  return {
    code: String(response.code || response.errorCode || "action_failed"),
    message: String(response.message || response.error || "").trim(),
  };
}

function humanActionName(diagnosticAction) {
  if (diagnosticAction?.[2]) {
    return diagnosticAction[2]
      .replace(/^(Abrindo|Ativando|Alterando|Atualizando|Duplicando|Encerrando|Enviando|Exportando|Gerando|Importando|Instalando|Liberando|Limpando|Preparando|Removendo|Salvando)\s+/i, "")
      .replace(/[.]$/, "")
      .toLocaleLowerCase("pt-BR");
  }
  return "uma ação interna";
}

function errorCode(error) {
  if (!error || typeof error !== "object") return "";
  return String(error.code || error.errorCode || "").trim();
}

function errorMessage(error) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    if (typeof error.message === "string") return error.message;
    return "Erro técnico sem detalhes disponíveis.";
  }
  return String(error || "Erro técnico sem detalhes.");
}
