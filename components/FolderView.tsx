"use client";
// Notes as folders, like a file explorer, arranged three ways (lib/ideaTree.ts):
//   Ideas   Category › Main idea › Sub-idea › notes (the same folders as the Home mind map)
//   Places  Place › Main idea › notes
//   People  Person or office › Main idea › notes
//   Issues  Issue (Drugs, Roads…) › Main idea › notes
// Tap a folder to open or close it, a note to open it, ↗ to see an idea's notes or a person's or place's profile.
// Searching shows only the folders holding matching notes, opened. The arrangement is remembered per browser.
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { day, plural } from "../lib/format";
import { bucketOf } from "../lib/buckets";
import { byEntity, folders, type Folder } from "../lib/ideaTree";
import type { MapData } from "../lib/types";
import { I } from "./IconButton";

type Props = {
  reloadKey: number;
  query: string;             // filter: note titles containing it
  bucket: string | null;     // only notes in this category
  onOpenNote: (id: string) => void;
  onOpenTopic: (id: string) => void;
  onOpenEntity: (id: string) => void;
};

type Arrange = "ideas" | "places" | "people" | "issues";
const ARRANGE: { a: Arrange; label: string; path: string }[] = [
  { a: "ideas", label: "Ideas", path: "Category › Main idea › Sub-idea › notes" },
  { a: "places", label: "Places", path: "Place › Main idea › notes" },
  { a: "people", label: "People", path: "Person or office › Main idea › notes" },
  { a: "issues", label: "Issues", path: "Issue › Main idea › notes" },
];

const BIG = 30;  // with more notes than this, sub-ideas start closed

/** Only the folders that hold a note whose title contains q and that passes keep (and those notes); counts follow. */
function filter(fs: Folder[], q: string, keep: (noteId: string) => boolean): Folder[] {
  return fs.flatMap(f => {
    if (f.kind === "note") return f.label.toLowerCase().includes(q) && keep(f.ref) ? [f] : [];
    const children = filter(f.children, q, keep);
    const count = new Set(children.flatMap(function notes(c: Folder): string[] { return c.kind === "note" ? [c.ref] : c.children.flatMap(notes); })).size;
    return children.length ? [{ ...f, children, count }] : [];
  });
}

const folderIcon = (colour: string, open: boolean) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={colour} strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
    {open ? <path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h13.2a1.5 1.5 0 0 0 1.45-1.1L21 11.5H7.2a1.5 1.5 0 0 0-1.43 1.04L3.6 19M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h6.5A1.5 1.5 0 0 1 19 9.5v2" />
      : <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V7.5Z" fill={colour} fillOpacity=".15" />}
  </svg>
);

export default function FolderView({ reloadKey, query, bucket, onOpenNote, onOpenTopic, onOpenEntity }: Props) {
  const [arrange, setArrangeState] = useState<Arrange>("ideas");
  useEffect(() => { try { const a = localStorage.getItem("folders-by") as Arrange | null; if (a && ARRANGE.some(x => x.a === a)) setArrangeState(a); } catch { /* storage off */ } }, []);
  const setArrange = (a: Arrange) => { setArrangeState(a); try { localStorage.setItem("folders-by", a); } catch { /* storage off */ } };
  const [data, setData] = useState<MapData | null>(null);
  const [failed, setFailed] = useState(false);
  const [closed, setClosed] = useState<Set<string> | null>(null);

  useEffect(() => { api("/graph/map").then(setData, () => setFailed(true)); }, [reloadKey]);
  const all = useMemo(() => !data ? [] : arrange === "places" ? byEntity(data, ["place"], "No place named")
    : arrange === "people" ? byEntity(data, ["person", "official"], "No one named")
    : arrange === "issues" ? byEntity(data, ["issue"], "No issue named") : folders(data), [data, arrange]);
  useEffect(() => { // first look: categories and main ideas open; sub-ideas too unless there are many notes
    if (data && closed === null) setClosed(new Set(data.notes.length > BIG ? all.flatMap(b => b.children.flatMap(m => m.children.filter(c => c.kind === "sub").map(c => c.id))) : []));
  }, [data, all, closed]);

  if (failed) return <p className="text-sm text-muted p-6">Couldn&apos;t load your folders. Is the API running?</p>;
  if (!data || !closed) return <div className="skeleton h-[320px] rounded-2xl" aria-busy="true" />;
  const q = query.trim().toLowerCase();
  const inBucket = new Set(data.notes.filter(n => !bucket || bucketOf(n.bucket) === bucket).map(n => n.id));
  const shown = filter(all, q, id => inBucket.has(id));
  const path = ARRANGE.find(x => x.a === arrange)!.path;

  const toggle = (id: string) => setClosed(c => { const s = new Set(c); if (s.has(id)) s.delete(id); else s.add(id); return s; });

  /** A folder (category, main idea, sub-idea) or a note, and what's inside when open. */
  const row = (f: Folder, depth: number): React.ReactNode => {
    const pad = { paddingLeft: 8 + depth * 22 };
    if (f.kind === "note") return (
      <li key={f.id}>
        <button onClick={() => onOpenNote(f.ref)} style={pad}
          className="w-full flex items-center gap-2.5 pr-3 py-1.5 rounded-lg text-left hover:bg-surface transition-colors group">
          <span className="w-[17px] flex justify-center shrink-0"><span className="w-1.5 h-1.5 rounded-full" style={{ background: f.colour }} /></span>
          <span className="flex-1 min-w-0 truncate text-[13.5px] text-ink group-hover:underline">{f.label}</span>
          {f.date && <span className="text-[12px] text-faint tabular-nums shrink-0">{day(f.date)}</span>}
        </button>
      </li>
    );
    const open = q ? true : !closed.has(f.id);
    return (
      <li key={f.id}>
        <div className="flex items-center rounded-lg hover:bg-surface transition-colors group">
          <button onClick={() => toggle(f.id)} aria-expanded={open} style={pad} className="flex-1 min-w-0 flex items-center gap-2.5 pr-2 py-1.5 text-left">
            <span className={`text-faint shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}>{I.chevron}</span>
            {folderIcon(f.colour, open)}
            <span className={`truncate ${f.kind === "bucket" || f.kind === "entity" ? "text-[14.5px] font-semibold text-ink" : f.kind === "main" ? "text-[14px] font-medium text-ink" : "text-[13.5px] text-soft"}`}>
              {f.kind === "sub" && <span className="text-faint">› </span>}{f.label}
            </span>
            <span className="text-[12px] text-faint tabular-nums shrink-0">{f.count}</span>
          </button>
          {f.kind !== "bucket" && f.ref && (
            <button onClick={() => (f.kind === "entity" ? onOpenEntity(f.ref) : onOpenTopic(f.ref))}
              title={f.kind === "entity" ? `Everything about ${f.label}` : `See the ${plural(f.count, "note")} of ${f.label}`}
              aria-label={f.kind === "entity" ? `Open ${f.label}` : `See the notes of ${f.label}`}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 w-7 h-7 mr-1 rounded-md flex items-center justify-center text-faint hover:text-primary shrink-0">↗</button>
          )}
        </div>
        {open && <ul className="relative" style={{ ["--guide" as string]: `${8 + depth * 22 + 7}px` }}>
          <span aria-hidden className="absolute top-0 bottom-1 w-px" style={{ left: "var(--guide)", background: f.colour, opacity: 0.25 }} />
          {f.children.map(c => row(c, depth + 1))}
        </ul>}
      </li>
    );
  };

  return (
    <div className="card p-2 sm:p-3" style={{ borderRadius: 18 }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-2 pb-2 mb-1 border-b border-line">
        <div className="seg" role="radiogroup" aria-label="Arrange folders by">
          <span className="seg-pill" aria-hidden style={{ width: `calc(${100 / ARRANGE.length}% - 2px)`, transform: `translateX(${ARRANGE.findIndex(x => x.a === arrange) * 100}%)` }} />
          {ARRANGE.map(x => (
            <button key={x.a} role="radio" aria-checked={arrange === x.a} onClick={() => setArrange(x.a)}
              className={`relative z-10 px-3 h-7 rounded-[7px] text-[12.5px] font-medium transition-colors ${arrange === x.a ? "text-ink" : "text-muted hover:text-soft"}`}>{x.label}</button>
          ))}
        </div>
        <p className="text-[12px] text-faint flex-1 min-w-0 truncate">{path}</p>
        {!q && <button onClick={() => setClosed(closed.size ? new Set() : new Set(shown.map(b => b.id)))} className="text-[12.5px] text-primary hover:underline">
          {closed.size ? "Open all" : "Close all"}</button>}
      </div>
      {shown.length ? <ul role="tree" aria-label="Your notes in folders">{shown.map(b => row(b, 0))}</ul>
        : <p className="text-sm text-muted p-6 text-center">{q ? `No note titles match "${query.trim()}".` : "No notes here yet."}</p>}
    </div>
  );
}
