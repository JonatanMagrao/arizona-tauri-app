export function formatDuration(durationMillis) {
  const totalSeconds = Math.max(0, Math.round(Number(durationMillis || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
