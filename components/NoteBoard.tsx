"use client";
// Masonry board of note cards: left-to-right order, each card dropped into the shortest column. A card shows what
// kind of note it is, its title and text (formatted, with the people, places and issues it mentions highlighted),
// chips for those, its next open promise with "Mark kept", and a star for important notes.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "../lib/api";
import { when } from "../lib/format";
import { KIND } from "../lib/kinds";
import type { EntityKind, Note } from "../lib/types";
import Menu from "./Menu";
import IconButton, { I } from "./IconButton";
import NoteText from "./NoteText";

export const noteAnchor = (id: string) => `note-${id}`;

type Props = {
  notes: Note[];
  batch?: number;            // stagger restarts each loaded batch, so card #300 doesn't wait 10s to appear
  highlightIds?: string[] | null;
  refreshing: Set<string>;   // text edited → waiting on re-enrichment
  onOpen: (id: string) => void;
  onCopy: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onToggleStar: (id: string) => void;
  onCheck: (id: string, index: number, done: boolean) => void;   // tick a checklist item
  onToggleDone: (id: string) => void;
};

const GAP = 12;
const colsFor = (w: number) => (w < 560 ? 1 : w < 860 ? 2 : w < 1100 ? 3 : 4);

export default function NoteBoard({ notes, batch = 30, highlightIds, refreshing, ...p }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const [cols, setCols] = useState(3);
  const [layout, setLayout] = useState<string[][]>([]);

  // Greedy masonry: walk notes in order, each into the currently shortest column.
  const place = () => {
    const h = Array(cols).fill(0);
    const out: string[][] = Array.from({ length: cols }, () => []);
    notes.forEach(n => {
      const i = h.indexOf(Math.min(...h));
      out[i].push(n.id);
      h[i] += (cards.current.get(n.id)?.offsetHeight ?? 160) + GAP;
    });
    setLayout(prev => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
  };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCols(colsFor(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // First pass uses estimates; card heights don't depend on which column they land in, so one re-place settles it.
  useLayoutEffect(place, [notes, cols]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); });
    cards.current.forEach(el => ro.observe(el));
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }); // re-bind every render: the card set grows as batches load

  const byId = new Map(notes.map(n => [n.id, n]));
  const order = new Map(notes.map((n, i) => [n.id, i]));
  const hot = highlightIds ? new Set(highlightIds) : null;
  const columns = layout.length === cols ? layout : Array.from({ length: cols }, (_, c) => notes.filter((_, i) => i % cols === c).map(n => n.id));

  return (
    <div ref={host} className="flex items-start" style={{ gap: GAP }}>
      {columns.map((ids, c) => (
        <div key={c} className="stagger flex-1 min-w-0 flex flex-col" style={{ gap: GAP }}>
          {ids.map(id => {
            const n = byId.get(id);
            return n ? (
              <NoteCard key={id} note={n} i={(order.get(id) ?? 0) % batch} match={!!hot?.has(id)}
                refreshing={refreshing.has(id)} {...p}
                setRef={el => { if (el) cards.current.set(id, el); else cards.current.delete(id); }} />
            ) : null;
          })}
        </div>
      ))}
    </div>
  );
}

// A phone number written in the note ("call 98140 12345") — the only way the app knows one.
export const phoneOf = (text: string) => (text.match(/(\+?\d[\d\s-]{8,}\d)/)?.[1] || "").replace(/[\s-]/g, "");

export const shareWhatsApp = (n: Note) =>
  window.open(`https://wa.me/?text=${encodeURIComponent(`${n.title ? n.title + "\n\n" : ""}${n.raw_text}`)}`, "_blank", "noopener");

// The order and label of the chips under a note, as in "Places · People · Groups · Officials · Issues".
const CHIP_ORDER: EntityKind[] = ["place", "person", "group", "official", "issue"];

/** "Due 5 Oct", "Due today 11:00". */
function dueLabel(iso: string, hasTime: boolean): string {
  const d = new Date(iso), today = new Date();
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86400000);
  const date = days === 0 ? "today" : days === 1 ? "tomorrow" : days < 0 ? `${-days}d overdue` : d.toLocaleDateString([], { day: "numeric", month: "short" });
  return `Due ${date}${hasTime && days >= 0 ? " " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}`;
}

export function NoteCard({ note: n, i, match, refreshing, onOpen, onCopy, onDelete, onTogglePin, onToggleStar, onCheck, onToggleDone, setRef }:
  Omit<Props, "notes" | "batch" | "highlightIds" | "refreshing"> & { note: Note; i: number; match: boolean; refreshing: boolean; setRef?: (el: HTMLElement | null) => void }) {
  const title = (n.title || "").trim();
  // What the note shows, without a first heading that only repeats its title.
  const text = (n.formatted || n.raw_text).trim().replace(/^#{1,3}\s+(.*)\n*/, (h, t: string) => (t.trim().toLowerCase() === title.toLowerCase() ? "" : h));
  const open = () => onOpen(n.id);
  const phone = phoneOf(n.raw_text);
  const done = !!n.done_at;
  const [kept, setKept] = useState<Set<string>>(new Set());
  const mentions = (n.mentions || []).filter(m => CHIP_ORDER.includes(m.kind));
  const marks = mentions.flatMap(m => [{ name: m.name, kind: m.kind }, ...(m.seen_as && m.seen_as.toLowerCase() !== m.name.toLowerCase() ? [{ name: m.seen_as, kind: m.kind }] : [])]);
  const chips = [...mentions].sort((a, b) => CHIP_ORDER.indexOf(a.kind) - CHIP_ORDER.indexOf(b.kind));
  const promise = (n.open_items || []).find(it => !kept.has(it.id));
  const idea = n.topics?.find(t => !t.parent_id);
  const keep = async (id: string) => {
    setKept(k => new Set(k).add(id));
    try { await api("/items", { method: "PATCH", body: JSON.stringify({ ids: [id], done: true }) }); } catch { setKept(k => { const x = new Set(k); x.delete(id); return x; }); }
  };

  return (
    <article ref={setRef} id={noteAnchor(n.id)} tabIndex={0} aria-haspopup="dialog" aria-label={title || text.slice(0, 60)}
      onClick={open}
      onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } }}
      style={{ "--i": i } as CSSProperties}
      className={`group scroll-anchor relative rounded-2xl border bg-bg cursor-pointer outline-none has-[[data-popover]]:z-30 has-[[role=menu]]:z-30
        transition-[box-shadow,transform,opacity,border-color] duration-200 hover:shadow-[0_14px_34px_-18px_rgb(var(--shadow)/.45)] hover:-translate-y-0.5
        focus-visible:shadow-[0_0_0_3px_var(--primary-100)] ${done ? "opacity-60 hover:opacity-100" : ""}
        ${match ? "border-primary shadow-[0_0_0_1px_var(--primary)]" : n.starred ? "border-[color-mix(in_srgb,var(--t-idea)_45%,var(--line))]" : "border-line hover:border-line-strong"}`}>
      <div className="px-4 pt-3.5 pb-2">
        <div className="flex items-center gap-2 text-[12px] text-faint">
          <span className="truncate"><b className="font-semibold text-muted">{n.form ? n.form[0].toUpperCase() + n.form.slice(1) : "Note"}</b>{n.source === "voice" ? ", voice note" : ""}</span>
          {n.pinned && <span className="text-primary [&_svg]:w-3.5 [&_svg]:h-3.5" title="Pinned">{I.pin2}</span>}
          <span className="ml-auto tabular-nums shrink-0">{n.created_at ? when(n.created_at) : ""}</span>
          <button onClick={e => { e.stopPropagation(); onToggleStar(n.id); }} aria-label={n.starred ? "Unstar" : "Star as important"} aria-pressed={!!n.starred}
            title={n.starred ? "Starred (important). Tap to unstar" : "Star as important"}
            className={`-mr-1 w-7 h-7 rounded-full flex items-center justify-center transition-[opacity,color] ${n.starred ? "text-[var(--t-idea)]" : "text-faint opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100 hover:text-[var(--t-idea)]"}`}>
            <Star filled={!!n.starred} />
          </button>
        </div>
        {title && <h3 className={`mt-1 text-[16px] font-semibold leading-snug text-ink break-words ${done ? "line-through decoration-faint" : ""}`}>{title}</h3>}
        {text && text !== title && (
          <div className="mt-1.5 text-[14px] leading-relaxed text-soft max-h-[10.5rem] overflow-hidden [mask-image:linear-gradient(to_bottom,#000_78%,transparent)]">
            <NoteText text={text} marks={marks} compact onCheck={(k, d) => onCheck(n.id, k, d)} />
          </div>
        )}
        {refreshing && (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-primary" role="status">
            <span className="animate-pulse">{I.sparkle}</span> {n.enrich_state === "pending" ? "Reading and connecting…" : "Refreshing…"}
          </p>
        )}
        {!!chips.length && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {chips.slice(0, 7).map(m => (
              <span key={m.id} className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full border border-line text-[12px] text-soft" title={KIND[m.kind].label}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: KIND[m.kind].fg }} aria-hidden />{m.name}
              </span>
            ))}
            {chips.length > 7 && <span className="h-6 px-1.5 text-[12px] text-faint inline-flex items-center">+{chips.length - 7}</span>}
          </div>
        )}
        {promise && (
          <div className="mt-2.5 rounded-xl bg-surface px-3 py-2 flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <p className="flex-1 min-w-0 text-[12.5px] text-soft leading-snug"><b className="text-ink font-semibold">{promise.kind === "promise" ? "Promise" : "Coming up"}:</b> {promise.text}</p>
            {promise.due_at && <span className="shrink-0 text-[11.5px] font-medium text-muted bg-bg rounded-md px-1.5 py-0.5">{dueLabel(promise.due_at, promise.due_has_time)}</span>}
            <button onClick={() => keep(promise.id)} className="shrink-0 h-7 px-2.5 rounded-full border border-line text-[12px] font-medium text-soft hover:border-primary hover:text-primary bg-bg">
              {promise.kind === "promise" ? "Mark kept" : "Done"}
            </button>
          </div>
        )}
        {idea && <p className="mt-2 text-[12px] text-faint truncate"># {idea.name}</p>}
      </div>

      {/* Quick actions on hover (always shown on touch screens). */}
      <div className="h-9 px-1.5 -mt-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 has-[[role=menu]]:opacity-100 transition-opacity duration-150"
        onClick={e => e.stopPropagation()}>
        <IconButton label={done ? "Mark not done" : "Mark done"} size={30} onClick={() => onToggleDone(n.id)} className={done ? "!text-[var(--t-person)]" : ""}>{I.check}</IconButton>
        <IconButton label={n.pinned ? "Unpin" : "Pin to top"} size={30} onClick={() => onTogglePin(n.id)} className={n.pinned ? "!text-primary" : ""}>{I.pin2}</IconButton>
        <IconButton label="Share on WhatsApp" size={30} onClick={() => shareWhatsApp(n)}>{I.whatsapp}</IconButton>
        {phone && <a href={`tel:${phone}`} aria-label={`Call ${phone}`} title={`Call ${phone}`}
          className="w-[30px] h-[30px] rounded-lg inline-flex items-center justify-center text-muted hover:text-ink hover:bg-surface">{I.phone}</a>}
        <span className="flex-1" />
        <Menu width={170} align="right"
          items={[
            { label: <>{I.copy} Copy text</>, onClick: () => onCopy(n.id) },
            { label: <>{I.trash} Delete</>, onClick: () => onDelete(n.id), danger: true },
          ]}
          trigger={({ open: mo, toggle }) => <IconButton label="More actions" size={30} aria-haspopup="menu" aria-expanded={mo} onClick={toggle}>{I.dots}</IconButton>} />
      </div>
    </article>
  );
}

/** The star for important notes, filled when starred. */
export function Star({ filled, size = 16 }: { filled: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z" />
    </svg>
  );
}
