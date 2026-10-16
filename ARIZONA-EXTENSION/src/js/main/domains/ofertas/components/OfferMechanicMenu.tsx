import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { getPublicErrorMessage } from "../../../utils/errors";
import { tooltipProps, type TooltipContent } from "../../../utils/tooltips";
import { useOfferMechanicOptions } from "../hooks/useOfferMechanicOptions";
import type { OfferMechanicChangeRequest, OfferLayoutOption } from "../types";
import "./OfferLayoutMenu.scss";
import "./OfferMechanicMenu.scss";

interface OfferMechanicMenuProps {
  offerLayerIndex: number;
  productIndex: number;
  label: string;
  tooltip?: TooltipContent;
  busy: boolean;
  resetKey: unknown;
  blocked?: boolean;
  onBeforeChange?: () => Promise<boolean>;
  onChange: (request: OfferMechanicChangeRequest) => Promise<void>;
  onStatus: (message: string) => void;
}

export const OfferMechanicMenu = ({
  offerLayerIndex,
  productIndex,
  label,
  tooltip,
  busy,
  resetKey,
  blocked = false,
  onBeforeChange,
  onChange,
  onStatus,
}: OfferMechanicMenuProps) => {
  const menuId = "offer-mechanic-menu-" + useId().replace(/:/g, "");
  const [isOpen, setIsOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const diagnosticRef = useRef<HTMLParagraphElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const openRef = useRef(false);
  const applyingRef = useRef(false);
  const contextRevisionRef = useRef(0);
  const mountedRef = useRef(true);
  const initialFocusRef = useRef<"current" | "first" | "last">("current");
  const { data, loading, error, reload } = useOfferMechanicOptions(offerLayerIndex, productIndex, isOpen, resetKey);
  const disabled = !window.cep || busy || blocked || applying;
  const disabledMessage = !window.cep
    ? "Abra este painel dentro do After Effects."
    : blocked
      ? "Feche a janela aberta para trocar a mecânica."
      : "Aguarde a atualização da oferta.";

  const closeMenu = useCallback((restoreFocus = false) => {
    openRef.current = false;
    setIsOpen(false);
    if (restoreFocus && triggerRef.current?.isConnected) triggerRef.current.focus();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      openRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    contextRevisionRef.current += 1;
    closeMenu();
  }, [offerLayerIndex, productIndex, resetKey, busy, blocked, closeMenu]);

  useEffect(() => {
    if (!isOpen) return;
    const containsTarget = (target: EventTarget | null) => target instanceof Node &&
      (triggerRef.current?.contains(target) || menuRef.current?.contains(target));
    const handleOutside = (event: Event) => {
      if (!containsTarget(event.target)) closeMenu();
    };
    const handleScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) {
        closeMenu();
      }
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    };
    const handleResize = () => closeMenu();
    document.addEventListener("pointerdown", handleOutside, true);
    document.addEventListener("focusin", handleOutside, true);
    document.addEventListener("keydown", handleEscape, true);
    document.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    window.addEventListener("blur", handleResize);
    return () => {
      document.removeEventListener("pointerdown", handleOutside, true);
      document.removeEventListener("focusin", handleOutside, true);
      document.removeEventListener("keydown", handleEscape, true);
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("blur", handleResize);
    };
  }, [isOpen, closeMenu]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!isOpen || !menu || !trigger) return;
    const viewport = document.documentElement;
    const anchor = trigger.getBoundingClientRect();
    menu.style.maxWidth = Math.max(0, viewport.clientWidth - 16) + "px";
    menu.style.maxHeight = Math.max(0, viewport.clientHeight - 16) + "px";
    const bounds = menu.getBoundingClientRect();
    const below = anchor.bottom + 6;
    const top = below + bounds.height <= viewport.clientHeight - 8
      ? below
      : anchor.top - bounds.height - 6;
    menu.style.left = Math.max(8, Math.min(anchor.right - bounds.width,
      viewport.clientWidth - bounds.width - 8)) + "px";
    menu.style.top = Math.max(8, Math.min(top,
      viewport.clientHeight - bounds.height - 8)) + "px";
    menu.style.visibility = "visible";

    if (error && retryRef.current) {
      retryRef.current.focus();
      return;
    }
    if (data && (!data.ok || !data.options.length) && diagnosticRef.current) {
      diagnosticRef.current.focus();
      return;
    }

    const options = optionRefs.current.filter(
      (option): option is HTMLButtonElement => option !== null && !option.disabled
    );
    const current = options.find((option) => option.getAttribute("aria-checked") === "true");
    const first = initialFocusRef.current === "last"
      ? options[options.length - 1]
      : initialFocusRef.current === "first" ? options[0] : current || options[0];
    (first || menu).focus();
  }, [isOpen, data, loading, error]);

  const openMenu = (focus: "current" | "first" | "last" = "current") => {
    if (!mountedRef.current || disabled || applyingRef.current) return;
    initialFocusRef.current = focus;
    openRef.current = true;
    setIsOpen(true);
  };

  const chooseOption = async (option: OfferLayoutOption) => {
    if (
      !mountedRef.current || !openRef.current || applyingRef.current ||
      disabled || !data?.ok || !data.context || !option.enabled || option.itemId === null
    ) return;
    // Even the current family may need its own instance in an older project.
    // The host decides whether this is a no-op or a shared source to separate.
    const request: OfferMechanicChangeRequest = {
      context: data.context,
      targetItemId: option.itemId,
    };
    const contextRevision = contextRevisionRef.current;
    applyingRef.current = true;
    setApplying(true);
    closeMenu(true);
    try {
      if (onBeforeChange && !(await onBeforeChange())) return;
      if (!mountedRef.current || contextRevisionRef.current !== contextRevision) return;
      await onChange(request);
    } catch (caught) {
      if (mountedRef.current) {
        onStatus(getPublicErrorMessage(caught, "Não foi possível trocar a mecânica deste produto."));
      }
    } finally {
      applyingRef.current = false;
      if (mountedRef.current) setApplying(false);
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      closeMenu(true);
      return;
    }
    const options = optionRefs.current.filter(
      (option): option is HTMLButtonElement => option !== null && !option.disabled
    );
    if (!options.length) return;
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number;
    if (event.key === "ArrowDown") nextIndex = (index + 1) % options.length;
    else if (event.key === "ArrowUp") nextIndex = (index + options.length - 1) % options.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = options.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    options[nextIndex].focus();
  };

  return (
    <>
      <span
        className="offer-layout-trigger-wrap offer-mechanic-trigger-wrap"
        {...tooltipProps(disabled ? disabledMessage : tooltip || "Trocar a mecânica deste produto")}
      >
        <button
          ref={triggerRef}
          type="button"
          className="offer-layout-trigger offer-mechanic-trigger"
          aria-label="Trocar mecânica do produto"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-controls={isOpen ? menuId : undefined}
          aria-busy={applying || (isOpen && loading)}
          disabled={disabled}
          onClick={() => isOpen ? closeMenu() : openMenu()}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            openMenu(event.key === "ArrowUp" ? "last" : "first");
          }}
        >
          <span className="offer-mechanic-trigger-label">{label}</span>
          <svg
            className="offer-mechanic-chevron"
            width="12" height="12" viewBox="0 0 16 16"
            fill="none" stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true" focusable="false"
          >
            <path d="M4 6 8 10 12 6" />
          </svg>
        </button>
      </span>
      {isOpen ? createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className="offer-layout-menu"
          role="menu"
          aria-label="Mecânicas do produto"
          aria-busy={loading}
          tabIndex={-1}
          style={{ visibility: "hidden" }}
          onKeyDown={handleMenuKeyDown}
        >
          {loading || (!data && !error) ? (
            <p className="offer-layout-message" role="status">Carregando mecânicas...</p>
          ) : error ? (
            <div className="offer-layout-feedback">
              <p className="offer-layout-message" role="alert">{error}</p>
              <button ref={retryRef} type="button" role="menuitem" onClick={reload}>
                Tentar novamente
              </button>
            </div>
          ) : data ? (
            <>
              {!data.ok || !data.options.length ? (
                <p
                  ref={diagnosticRef}
                  className="offer-layout-message offer-layout-diagnostic"
                  tabIndex={0}
                  {...tooltipProps({
                    title: "Mecânicas indisponíveis",
                    text: data.disabledSummary || data.message || "Nenhuma mecânica disponível.",
                    resolution: data.disabledReason,
                  })}
                >
                  <span className="offer-layout-info-icon" aria-hidden="true">i</span>
                  <span>
                    {data.disabledSummary || data.message || "Nenhuma mecânica disponível."}
                  </span>
                </p>
              ) : null}
              {data.options.map((option, index) => {
                const optionDisabled = !data.ok || !data.context || !option.enabled ||
                  option.itemId === null;
                return (
                  <div
                    className="offer-layout-option-wrap"
                    key={option.comment + ":" + index}
                    role="none"
                    {...tooltipProps(optionDisabled ? {
                      title: "Mecânica indisponível",
                      text: option.disabledSummary || data.disabledSummary || "Esta mecânica está indisponível.",
                      resolution: option.disabledReason || data.disabledReason,
                    } : undefined)}
                  >
                    <button
                      ref={(element) => { optionRefs.current[index] = element; }}
                      className="offer-layout-option"
                      type="button"
                      role="menuitemradio"
                      aria-checked={option.current}
                      disabled={optionDisabled}
                      tabIndex={-1}
                      onClick={() => void chooseOption(option)}
                    >
                      <span className="offer-layout-check" aria-hidden="true">
                        {option.current ? "✓" : ""}
                      </span>
                      <span>{option.label}</span>
                      {option.current ? <small>Atual</small> : null}
                    </button>
                  </div>
                );
              })}
            </>
          ) : null}
        </div>,
        document.body
      ) : null}
    </>
  );
};
