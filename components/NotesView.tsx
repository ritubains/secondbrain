"use client";
// Notes page body: notes grouped (Pinned · Today · This week · Earlier), shown as a Grid, a compact
// List, a Timeline by day, a Board with a column per bucket, or Folders (category › idea › sub-idea). The chosen view is remembered per browser.
import { useEffect, useState } from "react";
import type { Note } from "../lib/types";
import { bucketAccent, bucketOf } from "../lib/buckets";
import { day } from "../lib/format";
import NoteBoard, { NoteCard, phoneOf, shareWhatsApp, Star } from "./NoteBoard";
import IconButton, { I } from "./IconButton";

export type Mode = "grid" | "list" | "timeline" | "board" | "folders";  // folders: components/FolderView.tsx
const MODES: { m: Mode; label: string; icon: React.ReactNode }[] = [
  { m: "grid", label: "Grid", icon: I.grid }, { m: "list", label: "List", icon: I.rows },
  { m: "timeline", label: "Timeline", icon: I.timeline }, { m: "board", label: "Board", icon: I.board },
  { m: "folders", label: "Folders", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V7.5Z" /></svg> },
];

type Actions = {
  onOpen: (id: string) => void;
  onToggleStar: (id: string) => void;
  onCheck: (id: string, index: number, done: boolean) => void;
  onCopy: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onToggleDone: (id: string) => void;
};

type Props = Actions & {
  notes: Note[];          // the loaded list (search hits while searching)
  pinned: Note[];         // every pinned note, loaded separately so they always sit on top
  grouped: boolean;       // false while searching — results stay in relevance order
  highlightIds?: string[] | null;
  refreshing: Set<string>;
  batch: number;
};

// Today / This week / Earlier, by the viewer's calendar.
function groupOf(ts?: string): "Today" | "This week" | "Earlier" {
  if (!ts) return "Earlier";
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 6);
  return d >= start ? "This week" : "Earlier";
}

export function ModeSwitch({ mode, onMode }: { mode: Mode; onMode: (m: Mode) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label="View as">
      <span className="seg-pill" aria-hidden style={{ width: `calc(${100 / MODES.length}% - 1.5px)`, transform: `translateX(${MODES.findIndex(x => x.m === mode) * 100}%)` }} />
      {MODES.map(x => (
        <button key={x.m} role="radio" aria-checked={mode === x.m} onClick={() => onMode(x.m)} title={x.label}
          className={`relative z-10 inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3 h-8 rounded-[7px] text-[12.5px] font-medium transition-colors ${mode === x.m ? "text-ink" : "text-muted hover:text-soft"}`}>
          {x.icon}<span className="hidden md:inline">{x.label}</span>
        </button>
      ))}
    </div>
  );
}

export function useMode(): [Mode, (m: Mode) => void] {
  const [mode, setMode] = useState<Mode>("grid");
  useEffect(() => { try { const m = localStorage.getItem("notes-view") as Mode | null; if (m && MODES.some(x => x.m === m)) setMode(m); } catch { /* storage off */ } }, []);
  return [mode, (m: Mode) => { setMode(m); try { localStorage.setItem("notes-view", m); } catch { /* storage off */ } }];
}

// One compact row: List view and the Timeline both use it.
function Row({ n, a }: { n: Note; a: Actions }) {
  const done = !!n.done_at, phone = phoneOf(n.raw_text);
  return (
    <div onClick={() => a.onOpen(n.id)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter") a.onOpen(n.id); }}
      className={`group flex items-center gap-3 rounded-xl border border-line bg-bg px-3.5 py-2.5 cursor-pointer hover:shadow-[0_8px_22px_-14px_rgb(var(--shadow)/.4)] transition-shadow ${done ? "opacity-60 hover:opacity-100" : ""}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {n.starred && <span className="text-[var(--t-idea)] shrink-0" title="Starred"><Star filled size={14} /></span>}
          {n.pinned && <span className="text-primary [&_svg]:w-3.5 [&_svg]:h-3.5 shrink-0">{I.pin2}</span>}
          <span className={`truncate text-[14.5px] font-medium text-ink ${done ? "line-through decoration-faint" : ""}`}>{n.title || n.raw_text.slice(0, 70)}</span>
        </div>
        <p className="truncate text-[13px] text-muted mt-0.5">{n.summary || n.raw_text}</p>
      </div>
      <div className="hidden sm:flex items-center gap-3 text-[12px] text-muted shrink-0">
        {n.place && <span className="inline-flex items-center gap-1 [&_svg]:w-3 [&_svg]:h-3">{I.pin}{n.place}</span>}
        <span className="tabular-nums text-faint w-[52px] text-right">{n.created_at ? day(n.created_at) : ""}</span>
      </div>
      <div className="flex items-center gap-0.5 shrink-0 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
        <IconButton label={done ? "Mark not done" : "Mark done"} size={30} onClick={() => a.onToggleDone(n.id)} className={done ? "!text-[var(--t-person)]" : ""}>{I.check}</IconButton>
        <IconButton label={n.pinned ? "Unpin" : "Pin to top"} size={30} onClick={() => a.onTogglePin(n.id)} className={n.pinned ? "!text-primary" : ""}>{I.pin2}</IconButton>
        <IconButton label={n.starred ? "Unstar" : "Star as important"} size={30} onClick={() => a.onToggleStar(n.id)} className={n.starred ? "!text-[var(--t-idea)]" : ""}><Star filled={!!n.starred} /></IconButton>
        <IconButton label="Share on WhatsApp" size={30} onClick={() => shareWhatsApp(n)}>{I.whatsapp}</IconButton>
        {phone && <a href={`tel:${phone}`} aria-label={`Call ${phone}`} className="w-[30px] h-[30px] rounded-lg hidden sm:inline-flex items-center justify-center text-muted hover:text-ink hover:bg-surface">{I.phone}</a>}
      </div>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="mb-7" aria-label={title}>
      <h2 className="text-[13px] font-semibold uppercase tracking-[.06em] text-muted mb-3 flex items-center gap-2">
        {title}<span className="text-faint font-normal tabular-nums normal-case tracking-normal">{count}</span>
        <span className="flex-1 h-px bg-line" aria-hidden />
      </h2>
      {children}
    </section>
  );
}

export default function NotesView({ notes, pinned, grouped, highlightIds, refreshing, batch, mode, ...a }: Props & { mode: Mode }) {
  const pinIds = new Set(pinned.map(n => n.id));
  const rest = grouped ? notes.filter(n => !pinIds.has(n.id)) : notes;
  const groups: [string, Note[]][] = grouped
    ? ([["Pinned", pinned], ...(["Today", "This week", "Earlier"] as const).map(g => [g, rest.filter(n => groupOf(n.created_at) === g)])] as [string, Note[]][]).filter(([, ns]) => ns.length)
    : [["Results", rest]];
  const card = { ...a };

  if (mode === "board") {
    // A column per bucket, biggest first; Other last.
    const all = grouped ? [...pinned, ...rest] : rest;
    const cols = new Map<string, Note[]>();
    all.forEach(n => { const b = bucketOf(n.bucket); cols.set(b, [...(cols.get(b) || []), n]); });
    const order = Array.from(cols.entries()).sort((x, y) => (x[0] === "Other" ? 1 : y[0] === "Other" ? -1 : y[1].length - x[1].length));
    return (
      <div className="-mx-4 sm:-mx-6 lg:mx-0 px-4 sm:px-6 lg:px-0 overflow-x-auto pb-3">
        <div className="flex gap-4 items-start min-w-max">
          {order.map(([b, ns]) => (
            <section key={b} className="w-[300px] shrink-0 rounded-2xl bg-surface border border-line p-2.5" aria-label={b}>
              <h2 className="flex items-center gap-2 px-1.5 pt-1 pb-2.5 text-[13.5px] font-semibold">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: bucketAccent(b) }} aria-hidden />{b}
                <span className="text-faint font-normal tabular-nums">{ns.length}</span>
              </h2>
              <div className="flex flex-col gap-2.5">
                {ns.map((n, i) => <NoteCard key={n.id} note={n} i={i % batch} match={!!highlightIds?.includes(n.id)} refreshing={refreshing.has(n.id)} {...card} />)}
              </div>
            </section>
          ))}
        </div>
      </div>
    );
  }

  if (mode === "timeline") {
    const list = grouped ? [...pinned.filter(p => !rest.some(r => r.id === p.id)), ...rest] : rest;
    const byDay = new Map<string, Note[]>();
    list.forEach(n => { const k = n.created_at ? new Date(n.created_at).toDateString() : "Undated"; byDay.set(k, [...(byDay.get(k) || []), n]); });
    return (
      <ol className="relative ml-2 sm:ml-3 border-l-2 border-line">
        {Array.from(byDay.entries()).map(([k, ns]) => (
          <li key={k} className="relative pl-5 sm:pl-7 pb-6">
            <span className="absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-primary ring-4 ring-[var(--page)]" aria-hidden />
            <h2 className="text-[13px] font-semibold text-soft mb-2">
              {k === "Undated" ? k : new Date(k).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short", year: new Date(k).getFullYear() === new Date().getFullYear() ? undefined : "numeric" })}
              <span className="text-faint font-normal ml-2">{groupOf(ns[0].created_at)}</span>
            </h2>
            <div className="flex flex-col gap-2">{ns.map(n => <Row key={n.id} n={n} a={a} />)}</div>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div>
      {groups.map(([g, ns]) => (
        <Section key={g} title={g} count={ns.length}>
          {mode === "list" ? (
            <div className="flex flex-col gap-2">{ns.map(n => <Row key={n.id} n={n} a={a} />)}</div>
          ) : (
            <NoteBoard notes={ns} batch={batch} highlightIds={highlightIds} refreshing={refreshing} {...card} />
          )}
        </Section>
      ))}
    </div>
  );
}
