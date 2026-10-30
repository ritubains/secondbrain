"use client";
// What I know about you: the lasting facts memory has learned from your notes (GET /memory) — your profile, and
// what it knows per project. The chat uses them to understand you; anything wrong can be forgotten here.
// Your vocabulary (names, places, words) lives on the People page.
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ago, asYou } from "../lib/format";
import type { MemoryFact } from "../lib/types";
import IconButton, { I } from "./IconButton";

type Props = { reloadKey: number; onOpenNote: (id: string) => void; onNotice: (msg: string) => void };

const newest = (f: MemoryFact) => f.updated_at || f.created_at || "";

export default function MemoryView({ reloadKey, onOpenNote, onNotice }: Props) {
  const [facts, setFacts] = useState<MemoryFact[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [confirmAll, setConfirmAll] = useState(false);

  const load = () => api("/memory").then(
    (r: { enabled: boolean; items: MemoryFact[] }) => { setEnabled(r.enabled); setFacts([...r.items].sort((a, b) => newest(b).localeCompare(newest(a)))); },
    () => setFacts([]));
  useEffect(() => { load(); }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Forget one fact (put back if the API refuses). */
  const forget = async (f: MemoryFact) => {
    const before = facts;
    setFacts(l => (l || []).filter(x => x.id !== f.id));
    try { await api(`/memory/${f.id}`, { method: "DELETE" }); } catch { setFacts(before); onNotice("Couldn't forget that. Is the API running?"); }
  };

  const forgetAll = async () => {
    setConfirmAll(false);
    try { await api("/memory", { method: "DELETE" }); setFacts([]); onNotice("Forgotten. Your notes are untouched."); }
    catch { onNotice("Couldn't forget. Is the API running?"); }
  };

  // Profile facts first, then each project's.
  const groups = new Map<string, MemoryFact[]>();
  for (const f of facts || []) groups.set(f.project || "", [...(groups.get(f.project || "") || []), f]);

  return (
    <div className="anim-fade">
      <div className="flex flex-wrap items-center gap-3 mb-1.5">
        <h1 className="font-display text-[26px] font-semibold tracking-tight">What I know about you</h1>
        {!!facts?.length && (
          <span className="ml-auto flex items-center gap-1.5">
            {confirmAll ? (
              <>
                <span className="text-[13px] text-soft">Forget all {facts.length}?</span>
                <button onClick={forgetAll} className="btn h-8 px-3 text-[13px] font-semibold text-danger hover:bg-danger-50">Forget</button>
                <button onClick={() => setConfirmAll(false)} className="btn btn-ghost h-8 px-3 text-[13px]">Cancel</button>
              </>
            ) : <button onClick={() => setConfirmAll(true)} className="btn h-8 px-3 text-[13px] text-danger hover:bg-danger-50">Forget everything</button>}
          </span>
        )}
      </div>
      <p className="text-[13.5px] text-muted mb-5 max-w-[620px]">
        Lasting things picked up from your notes. The chat uses them to understand what you mean; answers still come from your notes. Remove anything that's wrong.
      </p>

      {!facts ? <div className="flex flex-col gap-2">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-[58px] rounded-xl" />)}</div>
        : !enabled ? <p className="text-sm text-muted">Memory is off. Set <code>MEMORY_ENGINE=mem0</code> in the API settings and restart it.</p>
        : !facts.length ? <p className="text-sm text-muted">Nothing yet. Write a few notes about your work, the places you cover and who you deal with.</p>
        : Array.from(groups.entries()).map(([project, list]) => (
          <section key={project} className="mb-4">
            <h2 className="text-[11.5px] font-semibold uppercase tracking-[.06em] text-faint mb-2">{project ? `Project · ${project}` : "About you"}</h2>
            <ul className="card divide-y divide-line overflow-hidden" style={{ borderRadius: 16 }}>
              {list.map(f => (
                <li key={f.id} className="group flex items-start gap-3 px-4 py-3">
                  <span className="mt-0.5 text-primary shrink-0">{I.sparkle}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14.5px] text-ink leading-snug">{asYou(f.memory)}</p>
                    <p className="mt-1 text-[12px] text-faint flex flex-wrap gap-x-2">
                      {f.note_id ? <button onClick={() => onOpenNote(f.note_id!)} className="hover:text-primary hover:underline">From a note</button> : <span>Learned</span>}
                      {newest(f) && <span>· {ago(newest(f))}</span>}
                    </p>
                  </div>
                  <IconButton label="Forget this" tone="danger" size={30} onClick={() => forget(f)} className="opacity-60 group-hover:opacity-100">{I.trash}</IconButton>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
