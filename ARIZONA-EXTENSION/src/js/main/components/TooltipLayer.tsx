import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TooltipContent } from "../utils/tooltips";
import "./TooltipLayer.scss";

interface ActiveTooltip extends TooltipContent {
  target: Element;
  trigger: "hover" | "focus";
}

const HOVER_DELAY_MS = 350;
const VIEWPORT_MARGIN = 8;

const findTooltipTarget = (target: EventTarget | null): Element | null => {
  let element = target instanceof Element ? target : null;

  while (element) {
    const candidate = element.closest("[data-tooltip]");
    if (!candidate) return null;
    if (candidate.getAttribute("data-tooltip")?.trim()) return candidate;
    element = candidate.parentElement;
  }

  return null;
};

const readTooltip = (
  target: Element,
  trigger: ActiveTooltip["trigger"]
): ActiveTooltip | null => {
  const text = target.getAttribute("data-tooltip");
  if (!target.isConnected || !text?.trim()) return null;

  return {
    target,
    trigger,
    text,
    title: target.getAttribute("data-tooltip-title") || undefined,
    resolution: target.getAttribute("data-tooltip-resolution") || undefined,
  };
};

const highlightQuotedText = (text: string) =>
  text.split(/("[^"\r\n]+"|“[^”\r\n]+”)/g).map((part, index) =>
    /^("|“)/.test(part) ? <strong key={index}>{part}</strong> : part
  );

const positionTooltip = (
  tooltip: HTMLDivElement,
  active: ActiveTooltip
) => {
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const targetRect = active.target.getBoundingClientRect();
  const belowY = targetRect.bottom + 8;
  const aboveY = targetRect.top - 8;
  const roomBelow = Math.max(0, viewportHeight - VIEWPORT_MARGIN - belowY);
  const roomAbove = Math.max(0, aboveY - VIEWPORT_MARGIN);

  tooltip.style.maxWidth =
    Math.max(0, Math.min(320, viewportWidth - VIEWPORT_MARGIN * 2)) + "px";
  tooltip.style.maxHeight = Math.max(0, viewportHeight - VIEWPORT_MARGIN * 2) + "px";
  const tooltipRect = tooltip.getBoundingClientRect();
  const placeBelow = tooltipRect.height <= roomBelow || roomBelow >= roomAbove;
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(
      targetRect.left,
      viewportWidth - tooltipRect.width - VIEWPORT_MARGIN
    )
  );
  const top = placeBelow ? belowY : aboveY - tooltipRect.height;

  tooltip.style.left = left + "px";
  tooltip.style.top = Math.max(
    VIEWPORT_MARGIN,
    Math.min(top, viewportHeight - tooltipRect.height - VIEWPORT_MARGIN)
  ) + "px";
  tooltip.style.visibility = "visible";
};

export const TooltipLayer = () => {
  const tooltipId = "arizona-tooltip-" + useId().replace(/:/g, "");
  const [active, setActive] = useState<ActiveTooltip | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let hoverTarget: Element | null = null;
    let keyboardInteraction = false;
    let showTimer = 0;

    const clearTimer = () => {
      window.clearTimeout(showTimer);
      showTimer = 0;
    };

    const hide = () => {
      clearTimer();
      setActive(null);
    };

    const show = (target: Element, trigger: ActiveTooltip["trigger"]) => {
      hide();
      if (trigger === "focus") {
        setActive(readTooltip(target, trigger));
      } else {
        showTimer = window.setTimeout(() => {
          showTimer = 0;
          setActive(readTooltip(target, trigger));
        }, HOVER_DELAY_MS);
      }
    };

    const handlePointerOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const target = findTooltipTarget(event.target);
      if (target === hoverTarget) return;
      hoverTarget = target;
      if (target) show(target, "hover");
      else hide();
    };

    const handlePointerOut = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const nextTarget = findTooltipTarget(event.relatedTarget);
      if (nextTarget === hoverTarget) return;
      hoverTarget = nextTarget;
      if (nextTarget) show(nextTarget, "hover");
      else hide();
    };

    const handleFocusIn = (event: FocusEvent) => {
      const focusTarget = findTooltipTarget(event.target);
      if (focusTarget && keyboardInteraction) show(focusTarget, "focus");
    };

    const handlePointerDown = () => {
      keyboardInteraction = false;
      hide();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        keyboardInteraction = false;
        hide();
      } else if (event.key === "Tab" || event.key.indexOf("Arrow") === 0) {
        keyboardInteraction = true;
      }
    };

    const handleWindowBlur = () => {
      hoverTarget = null;
      hide();
    };

    document.addEventListener("pointerover", handlePointerOver, true);
    document.addEventListener("pointerout", handlePointerOut, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("focusout", hide, true);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      clearTimer();
      document.removeEventListener("pointerover", handlePointerOver, true);
      document.removeEventListener("pointerout", handlePointerOut, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("focusout", hide, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!active || !tooltip) return;
    const target = active.target;
    const focusedElement = document.activeElement;
    const describedTarget =
      active.trigger === "focus" && focusedElement && target.contains(focusedElement)
        ? focusedElement
        : target;
    const describedBy = (describedTarget.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter(Boolean);
    if (describedBy.indexOf(tooltipId) < 0) describedBy.push(tooltipId);
    describedTarget.setAttribute("aria-describedby", describedBy.join(" "));

    positionTooltip(tooltip, active);

    const observer = new MutationObserver((mutations) => {
      if (!target.isConnected) {
        setActive(null);
      } else if (mutations.some((mutation) => mutation.type === "attributes")) {
        setActive(readTooltip(target, active.trigger));
      }
    });
    observer.observe(target, {
      attributes: true,
      attributeFilter: ["data-tooltip", "data-tooltip-title", "data-tooltip-resolution"],
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      const remainingIds = (describedTarget.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .filter((id) => id && id !== tooltipId);
      if (remainingIds.length) {
        describedTarget.setAttribute("aria-describedby", remainingIds.join(" "));
      } else {
        describedTarget.removeAttribute("aria-describedby");
      }
    };
  }, [active, tooltipId]);

  if (!active) return null;

  return createPortal(
    <div
      ref={tooltipRef}
      id={tooltipId}
      className="arizona-tooltip"
      role="tooltip"
      style={{ visibility: "hidden" }}
    >
      {active.title ? (
        <div className="arizona-tooltip-title">{active.title}</div>
      ) : null}
      <div className="arizona-tooltip-text">{highlightQuotedText(active.text)}</div>
      {active.resolution ? (
        <div className="arizona-tooltip-resolution">
          <span>Como resolver</span>
          <div>{highlightQuotedText(active.resolution)}</div>
        </div>
      ) : null}
    </div>,
    document.body
  );
};
