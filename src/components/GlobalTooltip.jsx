import { useEffect, useLayoutEffect, useRef, useState } from "react";

const TOOLTIP_ATTR = "data-tooltip";
const SHOW_DELAY_MS = 220;

function GlobalTooltip() {
  const tooltipRef = useRef(null);
  const activeTargetRef = useRef(null);
  const showTimerRef = useRef(null);
  const [tooltip, setTooltip] = useState({ open: false, text: "", rect: null, via: "pointer" });
  const [position, setPosition] = useState({ left: 0, top: 0, placement: "top" });

  useEffect(() => {
    const clearShowTimer = () => {
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
    };

    const hideTooltip = () => {
      clearShowTimer();
      activeTargetRef.current = null;
      setTooltip((current) => (current.open ? { open: false, text: "", rect: null, via: "pointer" } : current));
    };

    const convertTitle = (element) => {
      if (!(element instanceof HTMLElement) || !element.hasAttribute("title")) return;

      const title = element.getAttribute("title") || "";
      if (title.trim()) element.setAttribute(TOOLTIP_ATTR, title.trim());
      element.removeAttribute("title");
    };

    const scanTitles = (root) => {
      if (!(root instanceof Element)) return;
      convertTitle(root);
      root.querySelectorAll?.("[title]").forEach(convertTitle);
    };

    const tooltipTargetFrom = (target) => {
      if (!(target instanceof Element)) return null;
      const tooltipTarget = target.closest(`[${TOOLTIP_ATTR}]`);
      const activeScope = document.body.dataset.tooltipScope;

      if (!tooltipTarget || !activeScope) return tooltipTarget;
      return tooltipTarget.closest(`[data-tooltip-scope="${activeScope}"]`) ? tooltipTarget : null;
    };

    const isEditableTarget = (target) => {
      if (!(target instanceof Element)) return false;
      const editable = target.closest("input, textarea, select, [contenteditable='true']");
      return Boolean(editable);
    };

    const showTooltip = (target, via = "pointer") => {
      const text = target.getAttribute(TOOLTIP_ATTR)?.trim();
      if (!text) return;

      activeTargetRef.current = target;
      setTooltip({ open: true, text, rect: target.getBoundingClientRect(), via });
    };

    const scheduleTooltip = (target) => {
      clearShowTimer();
      showTimerRef.current = setTimeout(() => {
        showTooltip(target, "pointer");
        showTimerRef.current = null;
      }, SHOW_DELAY_MS);
    };

    const handlePointerOver = (event) => {
      scanTitles(event.target);
      const target = tooltipTargetFrom(event.target);
      if (!target || target === activeTargetRef.current) return;
      scheduleTooltip(target);
    };

    const handlePointerOut = (event) => {
      const target = activeTargetRef.current || tooltipTargetFrom(event.target);
      if (!target) {
        clearShowTimer();
        return;
      }

      if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
      hideTooltip();
    };

    const handleFocusIn = (event) => {
      scanTitles(event.target);
      const target = tooltipTargetFrom(event.target);
      if (target) showTooltip(target, "focus");
    };

    const handleFocusOut = (event) => {
      const target = activeTargetRef.current;
      if (!target) return;
      if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
      hideTooltip();
    };

    const handleTypingStart = (event) => {
      if (isEditableTarget(event.target)) hideTooltip();
    };

    scanTitles(document.body);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes") {
          convertTitle(mutation.target);
          return;
        }

        mutation.addedNodes.forEach(scanTitles);
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["title"],
    });

    document.addEventListener("pointerover", handlePointerOver, true);
    document.addEventListener("pointerout", handlePointerOut, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("focusout", handleFocusOut, true);
    document.addEventListener("keydown", handleTypingStart, true);
    document.addEventListener("beforeinput", handleTypingStart, true);
    document.addEventListener("input", handleTypingStart, true);
    document.addEventListener("compositionstart", handleTypingStart, true);
    window.addEventListener("app:hide-tooltip", hideTooltip);
    window.addEventListener("blur", hideTooltip);
    window.addEventListener("scroll", hideTooltip, true);
    window.addEventListener("resize", hideTooltip);

    return () => {
      observer.disconnect();
      document.removeEventListener("pointerover", handlePointerOver, true);
      document.removeEventListener("pointerout", handlePointerOut, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("focusout", handleFocusOut, true);
      document.removeEventListener("keydown", handleTypingStart, true);
      document.removeEventListener("beforeinput", handleTypingStart, true);
      document.removeEventListener("input", handleTypingStart, true);
      document.removeEventListener("compositionstart", handleTypingStart, true);
      window.removeEventListener("app:hide-tooltip", hideTooltip);
      window.removeEventListener("blur", hideTooltip);
      window.removeEventListener("scroll", hideTooltip, true);
      window.removeEventListener("resize", hideTooltip);
      clearShowTimer();
    };
  }, []);

  useLayoutEffect(() => {
    if (!tooltip.open || !tooltip.rect || !tooltipRef.current) return;

    const pad = 8;
    const gap = 8;
    const tooltipBox = tooltipRef.current.getBoundingClientRect();
    const center = tooltip.rect.left + tooltip.rect.width / 2;
    const left = Math.min(
      window.innerWidth - tooltipBox.width - pad,
      Math.max(pad, center - tooltipBox.width / 2)
    );
    let top = tooltip.rect.top - tooltipBox.height - gap;
    let placement = "top";

    if (top < pad) {
      top = tooltip.rect.bottom + gap;
      placement = "bottom";
    }

    setPosition({ left, top, placement });
  }, [tooltip]);

  if (!tooltip.open) return null;

  return (
    <div
      className="global-tooltip"
      data-placement={position.placement}
      data-nowrap={tooltip.text.length <= 36 ? "true" : undefined}
      ref={tooltipRef}
      role="tooltip"
      style={{ left: position.left, top: position.top }}
    >
      {tooltip.text}
    </div>
  );
}

export default GlobalTooltip;
