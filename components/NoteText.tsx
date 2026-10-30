"use client";
// A note's text for reading: Markdown as the editor writes it (headings, **bold**, *italic*, bullet and numbered
// lists, - [ ] checklists) and laid-out voice notes, with the people, places, offices, groups and issues it mentions
// highlighted where they appear, in their kind's colour. Plain text in, React out — nothing is parsed as HTML.
import { Fragment } from "react";
import { KIND } from "../lib/kinds";
import type { EntityKind } from "../lib/types";

export type Mark = { name: string; kind: EntityKind };
type Block =
  | { kind: "h"; level: number; text: string } | { kind: "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] } | { kind: "tasks"; items: { done: boolean; text: string }[] };

/** Lines → headings, paragraphs, lists and checklists. */
function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/\\$/, "").trim();  // "…\" at a line's end is a Markdown line break
    if (!line) continue;
    const last = out[out.length - 1];
    const h = line.match(/^(#{1,3})\s+(.*)$/), task = line.match(/^[-*]\s+\[( |x|X)\]\s+(.*)$/);
    const bullet = line.match(/^[-*•]\s+(.*)$/), num = line.match(/^\d+[.)]\s+(.*)$/);
    if (h) out.push({ kind: "h", level: h[1].length, text: h[2] });
    else if (task) {
      const item = { done: task[1] !== " ", text: task[2] };
      if (last?.kind === "tasks") last.items.push(item); else out.push({ kind: "tasks", items: [item] });
    } else if (bullet || num) {
      const kind = bullet ? "ul" : "ol", item = (bullet || num)![1];
      if (last && last.kind === kind) last.items.push(item); else out.push({ kind, items: [item] });
    } else if (line.endsWith(":") && line.length < 60) out.push({ kind: "h", level: 3, text: line });
    else out.push({ kind: "p", text: line });
  }
  return out;
}

/** **bold**, *italic* and the highlighted names inside one line. */
function Inline({ text, marks }: { text: string; marks: Mark[] }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g);
  return <>{parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}><Marked text={p.slice(2, -2)} marks={marks} /></strong>;
    if (/^(\*[^*].*\*|_[^_].*_)$/.test(p)) return <em key={i}><Marked text={p.slice(1, -1)} marks={marks} /></em>;
    return <Marked key={i} text={p} marks={marks} />;
  })}</>;
}

/** Highlight each mention (whole words, any case; longest names first so "Kheri Kalan" wins over "Kheri"). */
function Marked({ text, marks }: { text: string; marks: Mark[] }) {
  if (!marks.length || !text) return <>{text}</>;
  const sorted = [...marks].filter(m => m.name.length > 1).sort((a, b) => b.name.length - a.name.length);
  if (!sorted.length) return <>{text}</>;
  const kindOf = new Map(sorted.map(m => [m.name.toLowerCase(), m.kind]));
  const re = new RegExp(`\\b(${sorted.map(m => m.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi");
  const pieces = text.split(re);
  return <>{pieces.map((p, i) => {
    const kind = i % 2 ? kindOf.get(p.toLowerCase()) : undefined;
    return kind ? <mark key={i} className="rounded-[5px] px-1 -mx-[1px] text-ink" style={{ background: KIND[kind]?.bg }}>{p}</mark> : <Fragment key={i}>{p}</Fragment>;
  })}</>;
}

export default function NoteText({ text, marks = [], compact = false, onCheck }: {
  text: string; marks?: Mark[]; compact?: boolean;
  onCheck?: (index: number, done: boolean) => void;   // checklist items can be ticked (index among them, in order)
}) {
  let task = -1;  // each checklist item's place among them
  return (
    <div className={`note-text break-words ${compact ? "[&>*+*]:!mt-1" : ""}`}>
      {blocks(text).map((b, i) => {
        if (b.kind === "h") { const H = (["h1", "h2", "h3"] as const)[b.level - 1]; return <H key={i}><Inline text={b.text} marks={marks} /></H>; }
        if (b.kind === "p") return <p key={i}><Inline text={b.text} marks={marks} /></p>;
        if (b.kind === "tasks") return (
          <ul key={i} className="tasks space-y-0.5">{b.items.map((it, k) => {
            const at = ++task;
            return (
              <li key={k} className="flex items-start gap-2">
                <input type="checkbox" checked={it.done} aria-label={it.text} readOnly={!onCheck} tabIndex={onCheck ? 0 : -1}
                  onClick={e => e.stopPropagation()} onChange={e => onCheck?.(at, e.target.checked)}
                  className={`mt-[5px] shrink-0 ${onCheck ? "cursor-pointer" : "pointer-events-none"}`} />
                <span className={it.done ? "line-through text-faint" : ""}><Inline text={it.text} marks={marks} /></span>
              </li>
            );
          })}</ul>
        );
        const List = b.kind;
        return <List key={i} className="space-y-0.5">{b.items.map((it, k) => <li key={k}><Inline text={it} marks={marks} /></li>)}</List>;
      })}
    </div>
  );
}
