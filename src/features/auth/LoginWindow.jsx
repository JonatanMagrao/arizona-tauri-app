import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  activateWithCode,
  authErrorMessage,
  normalizeEmail,
  resumeSecureSession,
  verifyTotp,
} from "../../services/auth";
import { commandNames, invokeCommand } from "../../services/tauriCommands";
import {
  AUTH_MODES,
  acquireSubmission,
  authFlowErrorMessage,
  authFlowInstruction,
  authRetryState,
  releaseSubmission,
  shouldResetTotp,
} from "./loginFlow";

import appLogo from "../../../src-tauri/icons/arizona_icon.ico";
import closeIcon from "../../assets/icones/close.svg";
import minimizeIcon from "../../assets/icones/minimize.svg";

function LoginWindow() {
  const [mode, setMode] = useState(AUTH_MODES.ACTIVATION);
  const [draft, setDraft] = useState({ email: "", activationCode: "", totp: "" });
  const [appInfo, setAppInfo] = useState({ version: "" });
  const [enrollment, setEnrollment] = useState(null);
  const [hint, setHint] = useState("");
  const [toast, setToast] = useState({ message: "", variant: "error" });
  const [retryUntil, setRetryUntil] = useState(0);
  const [retryRemainingSeconds, setRetryRemainingSeconds] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const modeRef = useRef(mode);
  const retryUntilRef = useRef(0);
  const submitInFlightRef = useRef(false);
  const totpInputRef = useRef(null);

  const canSubmit = useMemo(() => {
    if (isBusy || retryRemainingSeconds > 0) return false;
    if (mode === AUTH_MODES.ACTIVATION) {
      return normalizeEmail(draft.email).includes("@")
        && normalizeActivationCode(draft.activationCode).length === 12;
    }
    return normalizeTotp(draft.totp).length === 6;
  }, [draft, isBusy, mode, retryRemainingSeconds]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

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

  useEffect(() => {
    let mounted = true;

    const applyExternalFlow = (event) => {
      if (mounted) applyFlow(event.detail);
    };
    window.addEventListener("arizona-auth:flow", applyExternalFlow);

    async function boot() {
      setIsBusy(true);
      try {
        const info = await invokeCommand(commandNames.appInfo);
        const version = String(info?.version || "").trim();
        if (!mounted) return;
        setAppInfo({ version });
        applyFlow(await resumeSecureSession({ appVersion: version }));
      } catch (error) {
        if (mounted) setToast({ message: authErrorMessage(error), variant: "error" });
      } finally {
        if (mounted) setIsBusy(false);
      }
    }

    boot();
    return () => {
      mounted = false;
      window.removeEventListener("arizona-auth:flow", applyExternalFlow);
    };
  }, []);

  const applyFlow = (flow) => {
    if (!flow) return;
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
      setDraft((current) => ({ ...current, activationCode: "", totp: "" }));
      return;
    }
    if (flow.state === "totp_enrollment_required") {
      modeRef.current = AUTH_MODES.ENROLLMENT;
      setMode(AUTH_MODES.ENROLLMENT);
      setEnrollment(flow.enrollment || null);
    } else if (flow.state === "totp_required") {
      modeRef.current = AUTH_MODES.TOTP;
      setMode(AUTH_MODES.TOTP);
      setEnrollment(null);
    } else if (flow.state === "activation_required") {
      modeRef.current = AUTH_MODES.ACTIVATION;
      setMode(AUTH_MODES.ACTIVATION);
      setEnrollment(null);
    }

    const instruction = authFlowInstruction(flow.state);
    if (flow.state === "error") {
      if (!retry.isRetryBlocked || retry.retryAfterSeconds <= 0) {
        setToast({
          message: authFlowErrorMessage(flow, modeRef.current),
          variant: "error",
        });
      }
      if (
        modeRef.current !== AUTH_MODES.ACTIVATION
        && shouldResetTotp(flow)
      ) {
        setDraft((current) => ({ ...current, totp: "" }));
        window.requestAnimationFrame(() => totpInputRef.current?.focus());
      }
    } else if (instruction) {
      setHint(instruction);
    } else if (flow.message) {
      setHint(flow.message);
    }
  };

  const updateDraft = (field, value) => {
    const nextValue = field === "activationCode"
      ? formatActivationCode(value)
      : field === "totp"
        ? normalizeTotp(value)
        : value;
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
      const flow = mode === AUTH_MODES.ACTIVATION
        ? await activateWithCode({
          email: normalizeEmail(draft.email),
          code: normalizeActivationCode(draft.activationCode),
          appVersion: appInfo.version,
        })
        : await verifyTotp({
          code: normalizeTotp(draft.totp),
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
  const title = mode === AUTH_MODES.ACTIVATION
    ? "Ativar acesso"
    : mode === AUTH_MODES.ENROLLMENT
      ? "Proteger acesso"
      : "Confirmar acesso";

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
            <h1 id="loginTitle">{title}</h1>
            <p className="login-subtitle">
              {mode === AUTH_MODES.ACTIVATION
                ? "Use o código entregue pelo seu gestor."
                : mode === AUTH_MODES.ENROLLMENT
                  ? "Escaneie o QR Code para criar uma nova entrada."
                  : "Use a entrada Arizona App já cadastrada."}
            </p>
          </div>
        </div>

        <form className="login-form" onSubmit={submit} noValidate>
          {mode === AUTH_MODES.ACTIVATION ? (
            <>
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
            </>
          ) : (
            <>
              {mode === AUTH_MODES.ENROLLMENT && enrollment && (
                <div className="login-mfa-enrollment">
                  {enrollment.qrCode && (
                    <img
                      className="login-mfa-qr"
                      src={enrollment.qrCode}
                      alt="QR Code para cadastrar o Arizona no autenticador"
                    />
                  )}
                  <div className="login-mfa-secret">
                    <span>Chave manual</span>
                    <code>{enrollment.secret}</code>
                  </div>
                </div>
              )}
              <label className="login-field">
                <span>Código do autenticador</span>
                <input
                  ref={totpInputRef}
                  className="input login-code-input login-code-input--totp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={draft.totp}
                  onChange={(event) => updateDraft("totp", event.target.value)}
                  disabled={isBusy}
                  placeholder="000000"
                  autoFocus
                />
              </label>
            </>
          )}

          <button className="btn btn-primary login-submit" type="submit" disabled={!canSubmit}>
            {isBusy
              ? "Validando..."
                : mode === AUTH_MODES.ACTIVATION
                  ? "Continuar"
                : mode === AUTH_MODES.ENROLLMENT
                  ? "Confirmar e entrar"
                  : "Entrar"}
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

function normalizeTotp(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 6);
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
