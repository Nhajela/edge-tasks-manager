const MAX = 60;
const WORDS = 8;

/** Fallback title before (or without) the AI: first ~8 words of the first line, no commands or @mentions. */
export function heuristicTitle(text: string): string {
  const line =
    text
      .replace(/^\s*\/\w+(@\w+)?/, "")
      .split("\n")
      .map((l) => l.replace(/(^|\s)@\w+/g, " ").trim())
      .find(Boolean) ?? "";
  const words = line.split(/\s+/).filter(Boolean);
  let title = words.slice(0, WORDS).join(" ").replace(/[\s.,;:!?-]+$/, "");
  if (!title) return "Request";
  if (title.length > MAX - 1) title = title.slice(0, MAX - 1).trimEnd();
  if (words.length > WORDS || title.length < line.replace(/[\s.,;:!?-]+$/, "").length) title += "…";
  return title.charAt(0).toUpperCase() + title.slice(1);
}
