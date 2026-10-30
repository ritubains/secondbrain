"use client";
// Note side panel: read and edit a note in place, in a Notion-like editor (a voice note opens laid out for reading).
// Star marks it important. Below the text: what it mentions (tap for everything about it),
// the promises / issues / dates / to-dos found in it, and its connected notes with why they're connected.
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Note, Project } from "../lib/types";
import { ITEM, KIND } from "../lib/kinds";
import { day, stamp } from "../lib/format";
import Menu from "./Menu";
import BucketPill from "./BucketPill";
import IconButton, { I } from "./IconButton";
import { Star } from "./NoteBoard";
import RichEditor, { type RichEditorHandle } from "./RichEditor";

export type NoteEdits = { title?: string; raw_text?: string };

type Props = {
  note: Note;
  projects: Project[];       // for "move to project"
  refreshing: boolean;
  onDone: (edits: NoteEdits, next?: string) => void; // close (or hop to a connected note) — page saves edits
  onToggleStar: () => void;
  onSetPlace: (place: string) => void;
  onSetProject: (projectId: string) => void;   // "" = no project
  onDelete: () => void;
  onOpenEntity: (id: string) => void;  // a chip → everything about that person / place / word
  onOpenTopic: (id: string) => void;   // a topic chip → all the notes in that topic
  onTopicsChanged: () => void;         // after adding / removing a topic
  onGraph: () => void;                 // show this note in the knowledge graph
  onNotice: (msg: string) => void;
};

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export default function NoteDialog({ note: n, projects, refreshing, onDone, onToggleStar, onSetPlace, onSetProject, onDelete, onOpenEntity, onOpenTopic, onTopicsChanged, onGraph, onNotice }: Props) {
  const [title, setTitle] = useState(n.title || "");
  const start = n.formatted || n.raw_text;   // a voice note opens laid out for reading; editing it keeps that layout
  const [text, setText] = useState(start);
  const panel = useRef<HTMLDivElement>(null);
  const [addingTopic, setAddingTopic] = useState(false);
  /** Put the note in a topic by name (an existing one if it matches), or take it out of one. */
  const addTopic = async (name: string) => {
    setAddingTopic(false);
    if (!name.trim()) return;
    try { await api(`/notes/${n.id}/topics`, { method: "POST", body: JSON.stringify({ name }) }); onTopicsChanged(); }
    catch { onNotice("Couldn't add the topic. Is the API running?"); }
  };
  const removeTopic = async (tid: string) => {
    try { await api(`/notes/${n.id}/topics/${tid}`, { method: "DELETE" }); onTopicsChanged(); }
    catch { onNotice("Couldn't remove the topic. Is the API running?"); }
  };
  const project = projects.find(p => p.id === n.project_id);
  const area = useRef<RichEditorHandle>(null);

  // Diff against the stored note; empty text is never saved (the note would vanish).
  const edits = (): NoteEdits => {
    const out: NoteEdits = {};
    const t = text.trim();
    if (t && t !== start.trim()) out.raw_text = t;
    if (title.trim() !== (n.title || "").trim() && title.trim()) out.title = title.trim();
    return out;
  };
  const done = (next?: string) => onDone(edits(), next);
  const dirty = Object.keys(edits()).length > 0;
  const [mac, setMac] = useState(true);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);

  // Lock page scroll, focus the text at its end.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => area.current?.focus(), 60);  // the editor mounts a moment after the panel
    return () => { document.body.style.overflow = prev; clearTimeout(t); };
  }, []);

  // Shortcuts live on document so they keep working after focus drops to <body>
  // (e.g. a menu item unmounts). Ref keeps the listener on the latest draft.
  const doneRef = useRef(done);
  doneRef.current = done;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const p = panel.current;
      if (!p) return;
      if (e.key === "Escape") {
        if (p.querySelector("[data-popover],[role=menu]")) return; // an open palette/menu closes first
        e.preventDefault(); doneRef.current(); return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); e.stopPropagation(); doneRef.current(); return; }
      if (e.key === "Tab") { // focus trap
        const f = Array.from(p.querySelectorAll<HTMLElement>("button:not(:disabled),input,textarea,[contenteditable=true],[tabindex]:not([tabindex='-1'])"))
          .filter(x => x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        const inside = p.contains(document.activeElement);
        if (!inside) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);


  const copyText = async () => onNotice((await copy(n.raw_text)) ? "Note text copied." : "Couldn't copy. Your browser blocked clipboard access.");
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: n.title || "", text: n.raw_text }); } catch { /* dismissed */ } }
    else copyText();
  };
  return (
    <div className="fixed inset-0 z-50 flex justify-end anim-fade"
      style={{ background: "rgb(var(--shadow) / .22)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) done(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={n.title || "Note"}
        className="panel-in w-full sm:w-[600px] h-[100dvh] flex flex-col border-l border-line bg-bg shadow-[-24px_0_60px_-30px_rgb(var(--shadow)/.5)]">

        <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-4 pb-2">
          <div className="flex items-start gap-2">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" aria-label="Title" maxLength={120}
              className="flex-1 min-w-0 bg-transparent outline-none font-display text-[22px] font-semibold tracking-tight text-ink placeholder:text-faint" />
            <button onClick={onToggleStar} aria-label={n.starred ? "Unstar" : "Star as important"} aria-pressed={!!n.starred} title={n.starred ? "Starred. Tap to unstar" : "Star as important"}
              className={`mt-1 w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface ${n.starred ? "text-[var(--t-idea)]" : "text-faint hover:text-[var(--t-idea)]"}`}>
              <Star filled={!!n.starred} size={18} />
            </button>
            <div className="pt-1.5 flex items-center gap-1.5">
              <Menu width={220}
                items={[{ heading: "Project" },
                  { label: "No project", active: !n.project_id, onClick: () => onSetProject("") },
                  ...projects.map(p => ({ label: p.name, active: n.project_id === p.id, onClick: () => onSetProject(p.id) }))]}
                trigger={({ open, toggle }) => (
                  <button onClick={toggle} aria-haspopup="menu" aria-expanded={open} title="Put this note in a project"
                    className="h-6 px-2.5 rounded-full border border-line text-[12px] text-soft hover:border-line-strong inline-flex items-center gap-1 [&_svg]:w-3.5 [&_svg]:h-3.5">
                    {I.board}{project ? project.name : "Add to project"}
                  </button>
                )} />
              {n.enrich_state !== "pending" && n.bucket && (
                <span title="Its category, learned from your notes"><BucketPill bucket={n.bucket} /></span>
              )}
            </div>
          </div>
          <div className="mt-3">
            <RichEditor ref={area} value={text} onChange={setText} placeholder="Take a note…" onSubmit={() => done()} minHeight={90} />
          </div>

          {/* Topics: the subjects it's part of — tap for all the notes in one. */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Topics">
            {(n.topics || []).map(t => (
              <span key={t.id} className="inline-flex items-center h-7 rounded-full border border-line text-[12.5px] text-soft">
                <button onClick={() => onOpenTopic(t.id)} className="pl-2.5 pr-1 hover:text-primary" title={`All notes in ${t.name}`}>{t.parent_id ? "› " : "# "}{t.name}</button>
                <button onClick={() => removeTopic(t.id)} aria-label={`Remove topic ${t.name}`} className="pr-2 text-faint hover:text-danger">×</button>
              </span>
            ))}
            {addingTopic ? (
              <form onSubmit={e => { e.preventDefault(); addTopic(String(new FormData(e.currentTarget).get("topic") || "")); }}>
                <input name="topic" autoFocus placeholder="Topic, e.g. Election strategy" aria-label="Add a topic" onBlur={e => addTopic(e.target.value)}
                  className="field h-7 px-2.5 text-[12.5px] bg-bg border border-line rounded-full w-[200px]" />
              </form>
            ) : (
              <button onClick={() => setAddingTopic(true)} className="h-7 px-2.5 rounded-full border border-dashed border-line text-[12.5px] text-faint hover:text-soft">+ topic</button>
            )}
          </div>

          {/* What it mentions — tap to see everything about it. */}
          {!!n.entities?.length && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Mentions">
              {n.entities.map(e => (
                <button key={e.id} onClick={() => { done(); onOpenEntity(e.id); }} title={e.meaning || `Everything about ${e.name}`}
                  className="chip-lift h-7 px-2.5 rounded-lg text-[13px] inline-flex items-center gap-1.5 hover:opacity-85 [&_svg]:w-3.5 [&_svg]:h-3.5"
                  style={{ background: KIND[e.kind].bg, color: KIND[e.kind].fg }}>{KIND[e.kind].icon}{e.name}</button>
              ))}
            </div>
          )}

          {/* place: fix it here when the AI got it wrong (the chip-style row above shows the rest) */}
          <label className="mt-1 flex items-center gap-1.5 text-[13px] text-muted [&_svg]:w-3.5 [&_svg]:h-3.5">
            <span className="text-faint">{I.pin}</span>
            <input key={n.place || ""} defaultValue={n.place || ""} placeholder="Add place" aria-label="Place" maxLength={80}
              onBlur={e => { const v = e.target.value.trim(); if (v !== (n.place || "")) onSetPlace(v); }}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
              className="flex-1 min-w-0 h-7 bg-transparent outline-none placeholder:text-faint" />
          </label>

          {/* Promises, issues, dates and to-dos the pipeline found. */}
          {!!n.items?.length && (
            <section className="mt-4">
              <h3 className="text-[11.5px] font-semibold uppercase tracking-[.06em] text-faint mb-1.5">In this note</h3>
              <ul className="flex flex-col gap-1">
                {n.items.map(i => (
                  <li key={i.id} className={`text-[14px] text-soft ${i.done_at ? "line-through opacity-60" : ""}`}>
                    <span className="text-[11.5px] font-semibold uppercase tracking-[.04em] text-faint mr-1.5">{ITEM[i.kind].label}</span>
                    {i.text}{i.who.length ? <span className="text-faint"> · {i.who.join(", ")}</span> : null}
                    {i.due_at && <span className="text-primary"> · {new Date(i.due_at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", ...(i.due_has_time ? { hour: "numeric", minute: "2-digit" } : {}) })}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Connected notes, any age, with why. */}
          {!!n.connected?.length && (
            <section className="mt-4">
              <h3 className="text-[11.5px] font-semibold uppercase tracking-[.06em] text-faint mb-1.5">Connected notes</h3>
              <div className="flex flex-col gap-1.5">
                {n.connected.map(c => (
                  <button key={c.id} onClick={() => done(c.id)} className="wash text-left rounded-lg px-3 py-2 hover:opacity-85">
                    <span className="block text-[13.5px] text-ink truncate">{c.title || c.raw_text.slice(0, 60)}</span>
                    <span className="block text-[11.5px] text-faint truncate">
                      {day(c.created_at)} · {c.shared.length ? `via ${c.shared.slice(0, 3).join(", ")}` : "similar in meaning"} · {Math.round(c.score * 100)}%
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {(refreshing || !!n.recordings?.length || n.updated_at || n.created_at) && (
            <div className="mt-3 flex items-center justify-end gap-3 text-[12px] text-muted tabular-nums">
              {!!n.recordings?.length && (() => {
                const s = Math.round(n.recordings.reduce((t, r) => t + (r.duration_ms || 0), 0) / 1000);
                const clips = n.recordings.length;
                return (
                  <span className="wash inline-flex items-center gap-1.5 h-6 px-2 rounded-md" title={`${clips} voice clip${clips > 1 ? "s" : ""} saved`}>
                    {I.mic} Voice · {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}{clips > 1 ? ` · ${clips} clips` : ""}
                  </span>
                );
              })()}
              {refreshing ? <span className="text-primary">Updating…</span>
                : (n.updated_at || n.created_at) && <span>Edited {stamp((n.updated_at || n.created_at)!)}</span>}
            </div>
          )}
        </div>

        {/* Keep-style toolbar */}
        <div className="shrink-0 flex items-center gap-0.5 px-2.5 py-2 border-t border-line">
          <IconButton label="Share" onClick={share}>{I.share}</IconButton>
          <button onClick={onGraph} className="btn h-9 px-2.5 text-[13px] text-soft gap-1.5 hover:bg-surface">{I.map} Graph</button>
          <Menu up width={170} align="left"
            items={[
              { label: <>{I.copy} Copy text</>, onClick: copyText },
              { label: <>{I.trash} Delete note</>, onClick: onDelete, danger: true },
            ]}
            trigger={({ open, toggle }) => <IconButton label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>{I.dots}</IconButton>} />
          {dirty ? (
            <button onClick={() => done()} title={`Save and close (${mac ? "⌘" : "Ctrl"}+Enter)`}
              className="anim-fade btn btn-primary h-9 pl-4 pr-2 text-[14px] ml-auto">
              Save
              <span className="hidden sm:inline-flex items-center h-5 px-1.5 rounded-md bg-white/20 text-[11px] font-medium">{mac ? "⌘" : "Ctrl"} ↵</span>
            </button>
          ) : (
            <button onClick={() => done()} title="Close (Esc)" className="btn h-9 px-4 text-[14px] font-medium text-ink ml-auto">Close</button>
          )}
        </div>
      </div>
    </div>
  );
}
