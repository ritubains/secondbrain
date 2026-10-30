// Short timestamp: time today ("4:22 PM"), else date ("22 Apr").
export function when(ts: string | number): string {
  const d = new Date(ts);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

// "Apr 22, 2026 · 4:22 PM"
export function stamp(ts: string | number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

// Whole days between ts and now (0 = today).
export function daysSince(ts: string | number): number {
  const a = new Date(ts), b = new Date();
  a.setHours(0, 0, 0, 0); b.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

// "today", "yesterday", "18 days ago"
export function ago(ts: string | number): string {
  const d = daysSince(ts);
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

// Day + month always ("18 Sep"), even for today.
export function day(ts: string | number): string {
  return new Date(ts).toLocaleDateString([], { day: "numeric", month: "short" });
}

const IRREGULAR: Record<string, string> = { is: "are", was: "were", has: "have", does: "do", focuses: "focus" }; // "-ses" is ambiguous (uses → use)

// The model writes "User works with…"; read it back as "You work with…". Anything else is shown as stored.
export function asYou(fact: string): string {
  const t = fact.trim();
  if (/^user's\s/i.test(t)) return "Your " + t.slice(7);
  const m = /^(?:the\s+)?user\s+(\S+)([\s\S]*)$/i.exec(t);
  if (!m) return t;
  const [, verb, rest] = m;
  const low = verb.toLowerCase();
  const v = IRREGULAR[low] ?? (/(ss|sh|ch|x|o)es$/.test(low) ? verb.slice(0, -2)
    : /[^aeiou]ies$/.test(low) ? verb.slice(0, -3) + "y"
    : /[^s]s$/.test(low) ? verb.slice(0, -1) : verb);
  return `You ${v}${rest}`;
}

// "1 note" / "3 notes" / plural(2, "person", "people")
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Stable number for a name, for picking its colour from a palette.
export function nameHash(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
