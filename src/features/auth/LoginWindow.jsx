import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  activateWithCode,
  authErrorMessage,
  normalizeEmail,
  resumeSecureSession,
} from "../../services/auth";
import { commandNames, invokeCommand } from "../../services/tauriCommands";
import { publicErrorCode } from "../../utils/publicErrors";
import { startAuthBootstrap } from "./authBootstrap";
import {
  LOGIN_SCREENS,
  acquireSubmission,
  automaticResumeRetryDelayMs,
  authFlowErrorMessage,
  authRetryState,
  loginScreenForFlow,
  normalizeAuthFlow,
  releaseSubmission,
  resumeRetryDelayMs,
} from "./loginFlow";

import appLogo from "../../../src-tauri/icons/arizona_icon.ico";
import closeIcon from "../../assets/icones/close.svg";
import minimizeIcon from "../../assets/icones/minimize.svg";

function LoginWindow() {
  const [screen, setScreen] = useState(LOGIN_SCREENS.CHECKING);
  const [draft, setDraft] = useState({ email: "", activationCode: "" });
  const [appInfo, setAppInfo] = useState({ version: "" });
  const [hint, setHint] = useState("");
  const [toast, setToast] = useState({ message: "", variant: "error" });
  const [statusCode, setStatusCode] = useState("");
  const [retryUntil, setRetryUntil] = useState(0);
  const [retryRemainingSeconds, setRetryRemainingSeconds] = useState(0);
  const [isBusy, setIsBusy] = useState(true);
  const retryUntilRef = useRef(0);
  const submitInFlightRef = useRef(false);
  const mountedRef = useRef(false);
  const appVersionRef = useRef("");
  const resumeRetryTimerRef = useRef(null);
  const resumeInFlightRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const activeRequestRef = useRef({ generation: 0, source: "resume" });

  const canSubmit = useMemo(() => {
    if (isBusy || retryRemainingSeconds > 0) return false;
    return normalizeEmail(draft.email).includes("@")
      && normalizeActivationCode(draft.activationCode).length === 12;
  }, [draft, isBusy, retryRemainingSeconds]);

  useEffect(() => {
    if (!retryUntil) {
      setRetryRemainingSeconds(0);
      return undefined;
    }

    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((retryUntil - Date.now()) / 1000));
      setRetryRemainingSeconds(remaining);
      if (!remaining) {
        retryUntilRef.current = 0;
        setRetryUntil(0);
      }
    };
    updateRemaining();
    const timer = setInterval(updateRemaining, 1000);
    return () => clearInterval(timer);
  }, [retryUntil]);

  const clearResumeRetry = () => {
    if (resumeRetryTimerRef.current) {
      clearTimeout(resumeRetryTimerRef.current);
      resumeRetryTimerRef.current = null;
    }
  };

  const beginRequest = (source) => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    activeRequestRef.current = { generation, source };
    return generation;
  };

  const finishRequest = (generation) => {
    if (!mountedRef.current || generation !== requestGenerationRef.current) return;
    setIsBusy(false);
    activeRequestRef.current = { generation, source: "external" };
  };

  const scheduleResumeRetry = (delayMs) => {
    if (!mountedRef.current || resumeRetryTimerRef.current || delayMs == null) return;
    resumeRetryTimerRef.current = setTimeout(() => {
      resumeRetryTimerRef.current = null;
      resumeSession({ showChecking: false });
    }, delayMs);
  };

  const applyFlow = (rawFlow, { source = "resume" } = {}) => {
    const flow = normalizeAuthFlow(rawFlow);
    if (!flow) return;

    clearResumeRetry();
    setHint("");
    setToast({ message: "", variant: "error" });

    const retry = authRetryState(flow);
    if (retry.isRetryBlocked && retry.retryAfterSeconds > 0) {
      const nextRetryUntil = Date.now() + retry.retryAfterSeconds * 1000;
      retryUntilRef.current = Math.max(retryUntilRef.current, nextRetryUntil);
      setRetryUntil(retryUntilRef.current);
      setRetryRemainingSeconds(Math.ceil((retryUntilRef.current - Date.now()) / 1000));
    } else {
      retryUntilRef.current = 0;
      setRetryUntil(0);
      setRetryRemainingSeconds(0);
    }

    scheduleResumeRetry(automaticResumeRetryDelayMs(flow, { source }));

    if (flow.email) {
      setDraft((current) => ({ ...current, email: normalizeEmail(flow.email) }));
    }

    setStatusCode(String(flow.code || "").trim().toLowerCase());

    if (flow.state === "authenticated") {
      setScreen(LOGIN_SCREENS.CHECKING);
      setHint("Acesso confirmado. Abrindo o Arizona...");
      setDraft((current) => ({ ...current, activationCode: "" }));
      return;
    }

    const nextScreen = loginScreenForFlow(flow, { source });
    const message = flow.message || flow.code
      ? authFlowErrorMessage(flow)
      : "";
    setScreen(nextScreen);

    if (nextScreen === LOGIN_SCREENS.ACTIVATION) {
      if (flow.code || flow.state === "error") {
        if (!retry.isRetryBlocked || retry.retryAfterSeconds <= 0) {
          setToast({ message, variant: "error" });
        }
      } else if (flow.message) {
        setHint(flow.message);
      }
      return;
    }

    setHint(
      message
      || (nextScreen === LOGIN_SCREENS.CONNECTION
        ? "Não conseguimos verificar seu acesso agora."
        : "Seu acesso não está disponível neste momento."),
    );
  };

  const applyRequestError = (error, source) => {
    applyFlow({
      state: "error",
      code: publicErrorCode(error),
      message: authErrorMessage(error),
    }, { source });
  };

  const resumeSession = async ({ showChecking = false } = {}) => {
    if (resumeInFlightRef.current || submitInFlightRef.current) return;

    clearResumeRetry();
    resumeInFlightRef.current = true;
    const generation = beginRequest("resume");
    setIsBusy(true);
    if (showChecking) {
      setScreen(LOGIN_SCREENS.CHECKING);
      setHint("Estamos verificando seu acesso.");
      setToast({ message: "", variant: "error" });
    }

    try {
      const flow = await resumeSecureSession({ appVersion: appVersionRef.current });
      if (!mountedRef.current || generation !== requestGenerationRef.current) return;
      applyFlow(flow, { source: "resume" });
    } catch (error) {
      if (!mountedRef.current || generation !== requestGenerationRef.current) return;
      applyRequestError(error, "resume");
    } finally {
      resumeInFlightRef.current = false;
      finishRequest(generation);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    const generation = beginRequest("resume");
    const startup = startAuthBootstrap();

    const applyExternalFlow = (event) => {
      if (!mountedRef.current) return;
      const source = activeRequestRef.current.source === "activation"
        ? "activation"
        : "resume";
      applyFlow(event.detail, { source });
    };
    window.addEventListener("arizona-auth:flow", applyExternalFlow);

    startup.appInfo.then((info) => {
      if (cancelled || !mountedRef.current) return;
      appVersionRef.current = info.version;
      setAppInfo(info);
    });

    startup.auth.then(({ flow, error }) => {
      if (
        cancelled
        || !mountedRef.current
        || generation !== requestGenerationRef.current
      ) {
        return;
      }
      if (error) applyRequestError(error, "resume");
      else applyFlow(flow, { source: "resume" });
      finishRequest(generation);
    });

    return () => {
      cancelled = true;
      mountedRef.current = false;
      clearResumeRetry();
      window.removeEventListener("arizona-auth:flow", applyExternalFlow);
    };
  }, []);

  const updateDraft = (field, value) => {
    const nextValue = field === "activationCode" ? formatActivationCode(value) : value;
    setDraft((current) => ({ ...current, [field]: nextValue }));
    if (toast.message) setToast({ message: "", variant: "error" });
  };

  const submit = async (event) => {
    event.preventDefault();
    if (
      !canSubmit
      || retryUntilRef.current > Date.now()
      || resumeInFlightRef.current
      || !acquireSubmission(submitInFlightRef)
    ) {
      return;
    }

    clearResumeRetry();
    const generation = beginRequest("activation");
    setIsBusy(true);
    try {
      const flow = await activateWithCode({
        email: normalizeEmail(draft.email),
        code: normalizeActivationCode(draft.activationCode),
        appVersion: appVersionRef.current,
      });
      if (!mountedRef.current || generation !== requestGenerationRef.current) return;
      applyFlow(flow, { source: "activation" });
    } catch (error) {
      if (!mountedRef.current || generation !== requestGenerationRef.current) return;
      applyRequestError(error, "activation");
    } finally {
      releaseSubmission(submitInFlightRef);
      finishRequest(generation);
    }
  };

  const retryNow = () => {
    if (isBusy || retryRemainingSeconds > 0) return;
    resumeSession({ showChecking: true });
  };

  const minimizeWindow = () => getCurrentWindow().minimize().catch(() => {});
  const closeWindow = async () => {
    try {
      await invokeCommand(commandNames.exitApp);
    } catch {
      getCurrentWindow().close().catch(() => {});
    }
  };

  const statusHasAutomaticRetry = resumeRetryDelayMs(statusCode) != null
    || (screen === LOGIN_SCREENS.CONNECTION && retryRemainingSeconds > 0);

  return (
    <main className="login-shell">
      <header className="app-titlebar" aria-label="Barra da janela">
        <div className="app-titlebar__brand" title="Arizona App">
          <img
            className="app-titlebar__logo"
            src={appLogo}
            alt=""
            aria-hidden="true"
          />
          <span>Arizona App</span>
        </div>
        <div className="app-titlebar__drag" />
        <div className="app-titlebar__controls">
          <button
            className="titlebar-icon-btn titlebar-icon-btn--minimize"
            onClick={minimizeWindow}
            tabIndex="-1"
            title="Minimizar"
            aria-label="Minimizar"
          >
            <img src={minimizeIcon} alt="" aria-hidden="true" />
          </button>
          <button
            className="titlebar-icon-btn titlebar-icon-btn--close"
            onClick={closeWindow}
            tabIndex="-1"
            title="Fechar"
            aria-label="Fechar"
          >
            <img src={closeIcon} alt="" aria-hidden="true" />
          </button>
        </div>
      </header>

      {screen === LOGIN_SCREENS.CHECKING && (
        <section
          className="login-panel login-panel--centered"
          aria-labelledby="startupTitle"
          aria-busy="true"
        >
          {appInfo.version && <span className="login-version">v{appInfo.version}</span>}
          <div className="login-startup" role="status" aria-live="polite">
            <img className="login-startup__logo" src={appLogo} alt="" aria-hidden="true" />
            <span className="login-startup__spinner" aria-hidden="true" />
            <div>
              <h1 id="startupTitle">Iniciando o Arizona</h1>
              <p>{hint || "Estamos verificando seu acesso."}</p>
            </div>
          </div>
        </section>
      )}

      {(screen === LOGIN_SCREENS.CONNECTION || screen === LOGIN_SCREENS.BLOCKED) && (
        <section className="login-panel login-panel--centered" aria-labelledby="statusTitle">
          {appInfo.version && <span className="login-version">v{appInfo.version}</span>}
          <div className="login-status">
            <img className="login-status__logo" src={appLogo} alt="" aria-hidden="true" />
            <div>
              <h1 id="statusTitle">
                {screen === LOGIN_SCREENS.CONNECTION
                  ? "Não conseguimos verificar seu acesso"
                  : "Seu acesso não está disponível"}
              </h1>
              <p className="login-status__message" role="alert">{hint}</p>
              {statusHasAutomaticRetry && (
                <p className="login-status__note">
                  O Arizona continuará verificando automaticamente.
                </p>
              )}
            </div>

            {retryRemainingSeconds > 0 && (
              <p className="login-hint login-hint--warning" role="status">
                {`Tente novamente em ${formatDuration(retryRemainingSeconds)}.`}
              </p>
            )}

            <button
              className="btn btn-primary login-status__retry"
              type="button"
              onClick={retryNow}
              disabled={isBusy || retryRemainingSeconds > 0}
            >
              {isBusy ? "Verificando..." : "Tentar novamente"}
            </button>
          </div>
        </section>
      )}

      {screen === LOGIN_SCREENS.ACTIVATION && (
        <section className="login-panel" aria-labelledby="loginTitle">
          {appInfo.version && <span className="login-version">v{appInfo.version}</span>}
          <div className="login-brand">
            <img src={appLogo} alt="" aria-hidden="true" />
            <div>
              <h1 id="loginTitle">Ativar acesso</h1>
              <p className="login-subtitle">Use o código entregue pelo seu gestor.</p>
            </div>
          </div>

          <form className="login-form" onSubmit={submit} noValidate>
            <label className="login-field">
              <span>E-mail</span>
              <input
                className="input"
                type="email"
                autoComplete="email"
                value={draft.email}
                onChange={(event) => updateDraft("email", event.target.value)}
                disabled={isBusy}
              />
            </label>
            <label className="login-field">
              <span>Código de ativação</span>
              <input
                className="input login-code-input"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                maxLength={14}
                value={draft.activationCode}
                onChange={(event) => updateDraft("activationCode", event.target.value)}
                disabled={isBusy}
                placeholder="XXXX-XXXX-XXXX"
              />
            </label>

            <button className="btn btn-primary login-submit" type="submit" disabled={!canSubmit}>
              {isBusy ? "Validando..." : "Continuar"}
            </button>
          </form>

          {hint && (
            <p className="login-hint" role="status">
              {hint}
            </p>
          )}

          {retryRemainingSeconds > 0 && (
            <p className="login-hint login-hint--warning" role="status">
              {`Muitas tentativas. Tente novamente em ${formatDuration(retryRemainingSeconds)}.`}
            </p>
          )}

          {toast.message && (
            <div className={`login-message login-message--${toast.variant}`} role="alert">
              {toast.message}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function normalizeActivationCode(value) {
  return String(value || "").toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "").slice(0, 12);
}

function formatActivationCode(value) {
  const normalized = normalizeActivationCode(value);
  return normalized.match(/.{1,4}/g)?.join("-") || normalized;
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.ceil(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}min`;
  if (minutes) return `${minutes}min ${String(remainder).padStart(2, "0")}s`;
  return `${remainder}s`;
}

export default LoginWindow;
