const EDITABLE_INPUT_TYPES = [
  "email",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "url",
];

export const isEditableOfferTextControl = (
  target: EventTarget | null
): boolean => {
  if (target instanceof HTMLInputElement) {
    return (
      EDITABLE_INPUT_TYPES.indexOf(target.type.toLowerCase()) >= 0 &&
      !target.disabled &&
      !target.readOnly
    );
  }

  if (target instanceof HTMLTextAreaElement) {
    return !target.disabled && !target.readOnly;
  }

  return target instanceof HTMLElement && target.isContentEditable;
};
