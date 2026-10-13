export interface TooltipContent {
  title?: string;
  text: string;
  resolution?: string;
}

export const tooltipProps = (
  content: string | TooltipContent | null | undefined
) => {
  const details = typeof content === "string" ? { text: content } : content;
  const text = details?.text.trim() ? details.text : undefined;

  return {
    "data-tooltip": text,
    "data-tooltip-title": text ? details?.title : undefined,
    "data-tooltip-resolution": text ? details?.resolution : undefined,
  };
};
