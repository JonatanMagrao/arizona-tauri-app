import { useEffect, useId, useRef, useState } from "react";

function AppDropdown({
  ariaLabel,
  className = "",
  disabled = false,
  onChange,
  options,
  value,
}) {
  const dropdownId = useId();
  const rootRef = useRef(null);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selectedOption = options[selectedIndex] || options[0];

  useEffect(() => {
    if (!isOpen) setActiveIndex(selectedIndex);
  }, [isOpen, selectedIndex]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setIsOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [isOpen]);

  const selectOption = (option) => {
    if (!option || option.disabled) return;
    if (option.value !== value) onChange?.(option.value);
    setIsOpen(false);
  };

  const moveActive = (direction) => {
    if (!options.length) return;

    setActiveIndex((current) => {
      let next = current;
      for (let attempts = 0; attempts < options.length; attempts += 1) {
        next = (next + direction + options.length) % options.length;
        if (!options[next]?.disabled) return next;
      }
      return current;
    });
  };

  const handleKeyDown = (event) => {
    if (disabled) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) setIsOpen(true);
      moveActive(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) setIsOpen(true);
      moveActive(-1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (isOpen) {
        selectOption(options[activeIndex]);
        return;
      }
      setIsOpen(true);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div
      className={`app-dropdown ${className}`.trim()}
      ref={rootRef}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        className="app-dropdown__trigger"
        aria-controls={`${dropdownId}-listbox`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span>{selectedOption?.label || ""}</span>
        <span className="app-dropdown__chevron" aria-hidden="true"></span>
      </button>

      {isOpen && (
        <div
          className="app-dropdown__menu"
          id={`${dropdownId}-listbox`}
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((option, index) => (
            <button
              type="button"
              className={`app-dropdown__option${option.value === value ? " app-dropdown__option--selected" : ""}${index === activeIndex ? " app-dropdown__option--active" : ""}`}
              disabled={option.disabled}
              key={option.value}
              onClick={() => selectOption(option)}
              role="option"
              aria-selected={option.value === value}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default AppDropdown;
