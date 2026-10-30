// Checklist items in a note: the "- [ ] …" lines of what it shows (its write-up, or the text as typed). The same
// rule as the API (routes/todos.py), so a tick shows at once and the server agrees.
import type { Note } from "./types";

const CHECK = /^(\s*[-*]\s+\[)( |x|X)(\]\s+)(.*)$/;

/** What a note shows: its write-up when it has one, else its text. */
export const shown = (n: Pick<Note, "formatted" | "raw_text">) => (n.formatted || n.raw_text || "");

/** The text with its index-th checklist item ticked (or unticked). */
export function tick(text: string, index: number, done: boolean): string {
  let seen = -1;
  return text.split("\n").map(line => {
    const m = line.match(CHECK);
    if (!m || ++seen !== index) return line;
    return `${m[1]}${done ? "x" : " "}${m[3]}${m[4]}`;
  }).join("\n");
}
