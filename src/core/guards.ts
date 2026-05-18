export function looksLikeFailedAdapterContent(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (/^\[(?:error|security)\]/i.test(trimmed)) return true;
  if (/^(?:error|failed|upstream|timeout)\b/i.test(trimmed)) return true;

  const meaningful = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!meaningful.length) return true;

  const failureLines = meaningful.filter((line) =>
    /\b(?:error|failed|failure|timeout|401|403|404|429|5\d\d)\b/i.test(line)
  );
  return failureLines.length === meaningful.length;
}
