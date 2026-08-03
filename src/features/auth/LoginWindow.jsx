import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  activateWithCode,
  authErrorMessage,
  normalizeEmail,
  resumeSecureSession,
} from "../../services/auth";
import { commandNames, invokeCommand } from "../../services/tauriCommands";
import {
  acquireSubmission,
  authFlowErrorMessage,
  authRetryState,
  normalizeAuthFlow,
  releaseSubmission,
  resumeRetryDelayMs,
} from "./loginFlow";

import appLogo from "../../../src-tauri/icons/arizona_icon.ico";
import closeIcon from "../../assets/icones/close.svg";
import minimizeIcon from "../../assets/icones/minimize.svg";

function LoginWindow() {
  const [draft, setDraft] = useState({ email: "", activationCode: "" });
  const [appInfo, setAppInfo] = useState({ version: "" });
  const [hint, setHint] = useState("");
  const [toast, setToast] = useState({ message: "", variant: "error" });
  const [retryUntil, setRetryUntil] = useState(0);
  const [retryRemainingSeconds, setRetryRemainingSeconds] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const retryUntilRef = useRef(0);
  const submitInFlightRef = useRef(false);
  const mountedRef = useRef(false);
  const appVersionRef = useRef("");
  const resumeRetryTimerRef = useRef(null);
  const resumeInFlightRef = useRef(false);

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

  const scheduleResumeRetry = (delayMs) => {
    if (!mountedRef.current || resumeRetryTimerRef.current) return;
    resumeRetryTimerRef.current = setTimeout(() => {
      resumeRetryTimerRef.current = null;
      resumeSession();
    }, delayMs);
  };

  const resumeSession = async () => {
    if (resumeInFlightRef.current) return;
    resumeInFlightRef.current = true;
    try {
      const flow = await resumeSecureSession({ appVersion: appVersionRef.current });
      if (!mountedRef.current) return;
      applyFlow(flow);
    } catch (error) {
      if (!mountedRef.current) return;
      setToast({ message: authErrorMessage(error), variant: "error" });
      if (String(error?.message || error || "").includes("network_error")) {
        scheduleResumeRetry(resumeRetryDelayMs("network_error"));
      }
    } finally {
      resumeInFlightRef.current = false;
    }
  };

  useEffect(() => {
    mountedRef.current = true;

    const applyExternalFlow = (event) => {
      if (mountedRef.current) applyFlow(event.detail);
    };
    window.addEventListener("arizona-auth:flow", applyExternalFlow);

    async function boot() {
      setIsBusy(true);
      try {
        const info = await invokeCommand(commandNames.appInfo);
        const version = String(info?.version || "").trim();
        if (!mountedRef.current) return;
        appVersionRef.current = version;
        setAppInfo({ version });
        await resumeSession();
      } catch (error) {
        if (mountedRef.current) setToast({ message: authErrorMessage(error), variant: "error" });
      } finally {
        if (mountedRef.current) setIsBusy(false);
      }
    }

    boot();
    return () => {
      mountedRef.current = false;
      clearResumeRetry();
      window.removeEventListener("arizona-auth:flow", applyExternalFlow);
    };
  }, []);

  const applyFlow = (rawFlow) => {
    const flow = normalizeAuthFlow(rawFlow);
    if (!flow) return;
    // Single-flight: any new flow replaces the pending silent resume retry.
    // network_error keeps its 15s cadence; the reversible org-wide blocks
    // (license_expired / organization_not_active) retry every 60s until the
    // license returns; every other state stops the timer.
    clearResumeRetry();
    const resumeDelay = flow.state === "authenticated" ? null : resumeRetryDelayMs(flow.code);
    if (resumeDelay != null) scheduleResumeRetry(resumeDelay);
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
    if (flow.email) {
      setDraft((current) => ({ ...current, email: normalizeEmail(flow.email) }));
    }

    if (flow.state === "authenticated") {
      setDraft((current) => ({ ...current, activationCode: "" }));
      return;
    }

    if (flow.state === "error") {
      if (!retry.isRetryBlocked || retry.retryAfterSeconds <= 0) {
        setToast({ message: authFlowErrorMessage(flow), variant: "error" });
      }
    } else if (flow.message) {
      setHint(flow.message);
    }
  };

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
      || !acquireSubmission(submitInFlightRef)
    ) {
      return;
    }

    setIsBusy(true);
    try {
      const flow = await activateWithCode({
        email: normalizeEmail(draft.email),
        code: normalizeActivationCode(draft.activationCode),
        appVersion: appInfo.version,
      });
      applyFlow(flow);
    } catch (error) {
      setToast({ message: authErrorMessage(error), variant: "error" });
    } finally {
      releaseSubmission(submitInFlightRef);
      setIsBusy(false);
    }
  };

  const minimizeWindow = () => getCurrentWindow().minimize().catch(() => {});
  const closeWindow = async () => {
    try {
      await invokeCommand(commandNames.exitApp);
    } catch {
      getCurrentWindow().close().catch(() => {});
    }
  };

  return (
    <main className="login-shell">
      <header className="app-titlebar" aria-label="Barra da janela">
        <div
          className="app-titlebar__brand"
          title="Arizona App"
        >
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
