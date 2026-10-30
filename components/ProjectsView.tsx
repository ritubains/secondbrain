"use client";
// Projects: a named context holding notes and conversations, like a project in Claude. Its description and
// instructions are what the chat knows about it; a chat started here answers from this project's notes first.
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { ago, day, plural } from "../lib/format";
import type { Note, NotesPage, Project, ProjectDetail } from "../lib/types";
import IconButton, { I } from "./IconButton";

type Props = {
  reloadKey: number;
  openId: string | null;
  onOpen: (id: string | null) => void;
  onOpenNote: (id: string) => void;
  onAddNote: (projectId: string) => void;            // capture a note straight into this project
  onChat: (projectId: string) => void;               // start a chat in this project
  onOpenChat: (conversationId: string) => void;
  onNotice: (msg: string) => void;
};

export default function ProjectsView(p: Props) {
  return p.openId ? <Detail {...p} id={p.openId} /> : <List {...p} />;
}

/** Every project, and a form for a new one. */
function List({ reloadKey, onOpen, onNotice }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => { api("/projects").then((r: { projects: Project[] }) => setProjects(r.projects), () => setProjects([])); }, [reloadKey]);

  return (
    <div className="anim-fade">
      <div className="flex items-center gap-3 mb-5">
        <h1 className="font-display text-[26px] font-semibold tracking-tight">Projects</h1>
        {!creating && <button onClick={() => setCreating(true)} className="btn btn-primary h-8 px-3 text-[13px] gap-1.5 ml-auto">{I.plus} New project</button>}
      </div>
      {creating && <ProjectForm onCancel={() => setCreating(false)} onNotice={onNotice}
        onSaved={pr => { setCreating(false); onOpen(pr.id); }} />}
      {!projects ? <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-[110px] rounded-[18px]" />)}</div>
        : !projects.length && !creating ? (
          <div className="rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
            <h2 className="text-[18px]">No projects yet</h2>
            <p className="text-sm text-muted mt-1.5 max-w-sm mx-auto">A project keeps related notes and chats together, with instructions the chat follows, like "Drainage work in the Kheri belt, report to the XEN weekly".</p>
            <button onClick={() => setCreating(true)} className="btn btn-primary h-9 px-4 text-[13px] mt-5">Make a project</button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map(pr => (
              <button key={pr.id} onClick={() => onOpen(pr.id)} className="card text-left p-4 hover:border-line-strong flex flex-col gap-1.5" style={{ borderRadius: 18 }}>
                <span className="text-[16px] font-semibold text-ink">{pr.name}</span>
                {pr.description && <span className="text-[13px] text-soft line-clamp-2">{pr.description}</span>}
                <span className="text-[12px] text-faint mt-auto">{plural(pr.notes, "note")} · {plural(pr.conversations, "chat")} · active {ago(pr.active_at)}</span>
              </button>
            ))}
          </div>
        )}
    </div>
  );
}

/** One project: its context (editable), its notes, its chats. */
function Detail({ id, reloadKey, onOpen, onOpenNote, onAddNote, onChat, onOpenChat, onNotice }: Props & { id: string }) {
  const [pr, setPr] = useState<ProjectDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const load = () => api(`/projects/${id}`).then(setPr, () => { onNotice("That project is gone."); onOpen(null); });
  useEffect(() => { load(); }, [id, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Take a note out of the project (the note stays). */
  const takeOut = async (nid: string) => {
    if (pr) setPr({ ...pr, notes: pr.notes.filter(n => n.id !== nid) });
    try { await api(`/projects/${id}/notes/${nid}`, { method: "DELETE" }); } catch { onNotice("Couldn't take it out. Is the API running?"); load(); }
  };

  const remove = async () => {
    if (!pr || !confirm(`Delete "${pr.name}"? Its chats go; its notes stay, outside any project.`)) return;
    try { await api(`/projects/${id}`, { method: "DELETE" }); onOpen(null); } catch { onNotice("Couldn't delete it. Is the API running?"); }
  };

  if (!pr) return <div className="skeleton h-[400px] rounded-[20px]" aria-busy="true" />;
  return (
    <div className="anim-fade flex flex-col gap-4">
      <div className="flex items-center gap-1">
        <IconButton label="All projects" onClick={() => onOpen(null)}>{I.back}</IconButton>
        <h1 className="font-display text-[24px] font-semibold tracking-tight flex-1 min-w-0 truncate">{pr.name}</h1>
        <IconButton label="Edit project" onClick={() => setEditing(v => !v)}>{I.edit}</IconButton>
        <IconButton label="Delete project" tone="danger" onClick={remove}>{I.trash}</IconButton>
      </div>
      {editing ? <ProjectForm project={pr} onCancel={() => setEditing(false)} onNotice={onNotice}
        onSaved={next => { setPr({ ...pr, ...next, notes: pr.notes }); setEditing(false); }} />
        : (pr.description || pr.instructions) && (
          <section className="card p-4" style={{ borderRadius: 18 }}>
            {pr.description && <p className="text-[14.5px] text-ink">{pr.description}</p>}
            {pr.instructions && <p className="text-[13px] text-muted mt-1.5 whitespace-pre-wrap"><b className="text-soft">The chat knows: </b>{pr.instructions}</p>}
          </section>
        )}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => onAddNote(id)} className="btn btn-primary h-9 px-4 text-[13.5px] gap-1.5">{I.plus} New note here</button>
        <button onClick={() => setPicking(v => !v)} className="btn btn-ghost h-9 px-4 text-[13.5px] gap-1.5">{I.list} Add existing notes</button>
        <button onClick={() => onChat(id)} className="btn btn-ghost h-9 px-4 text-[13.5px] gap-1.5">{I.sparkle} Chat in this project</button>
      </div>
      {picking && <NotePicker exclude={pr.notes.map(n => n.id)} onCancel={() => setPicking(false)} onNotice={onNotice}
        onAdd={async ids => {
          setPicking(false);
          try { await api(`/projects/${id}/notes`, { method: "POST", body: JSON.stringify({ note_ids: ids }) }); load(); }
          catch { onNotice("Couldn't add them. Is the API running?"); }
        }} />}
      <div className="grid gap-3 lg:grid-cols-[1fr_300px] items-start">
        <section className="card p-4" style={{ borderRadius: 18 }}>
          <h2 className="text-[15px] font-semibold mb-2">Notes ({pr.notes.length})</h2>
          {!pr.notes.length && <p className="text-[13.5px] text-faint">No notes yet. Write one here, add existing ones, or pick this project from a note.</p>}
          <div className="flex flex-col divide-y divide-line">
            {pr.notes.map(n => (
              <div key={n.id} className="group flex items-center gap-2">
                <button onClick={() => onOpenNote(n.id)} className="flex-1 min-w-0 text-left py-2.5 hover:opacity-80">
                  <span className="block text-[14px] text-ink">{n.title || n.raw_text.slice(0, 60)}</span>
                  <span className="block text-[12px] text-faint truncate">{day(n.created_at!)}{n.place ? ` · ${n.place}` : ""} · {n.raw_text.slice(0, 100)}</span>
                </button>
                <IconButton label="Take out of this project" size={28} onClick={() => takeOut(n.id)} className="opacity-50 group-hover:opacity-100">{I.x}</IconButton>
              </div>
            ))}
          </div>
        </section>
        <section className="card p-4" style={{ borderRadius: 18 }}>
          <h2 className="text-[15px] font-semibold mb-2">Chats</h2>
          {!pr.conversation_list.length && <p className="text-[13.5px] text-faint">None yet.</p>}
          {pr.conversation_list.map(c => (
            <button key={c.id} onClick={() => onOpenChat(c.id)} className="w-full text-left py-1.5 hover:opacity-80">
              <span className="block text-[13.5px] text-ink truncate">{c.title}</span>
              <span className="block text-[11.5px] text-faint">{ago(c.updated_at)}</span>
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}

/** Create or edit a project: name, what it's about, and what the chat should know or do. */
function ProjectForm({ project, onSaved, onCancel, onNotice }: { project?: ProjectDetail; onSaved: (p: Project) => void; onCancel: () => void; onNotice: (m: string) => void }) {
  const [name, setName] = useState(project?.name || "");
  const [description, setDescription] = useState(project?.description || "");
  const [instructions, setInstructions] = useState(project?.instructions || "");
  const field = "field w-full px-3 text-[13.5px] bg-bg border border-line rounded-xl placeholder:text-faint";
  const save = async () => {
    try {
      const body = JSON.stringify({ name, description, instructions });
      onSaved(await api(project ? `/projects/${project.id}` : "/projects", { method: project ? "PUT" : "POST", body }));
    } catch { onNotice("Couldn't save the project. Is the API running?"); }
  };
  return (
    <form onSubmit={e => { e.preventDefault(); if (name.trim()) save(); }} className="card p-4 mb-4 flex flex-col gap-2" style={{ borderRadius: 18 }}>
      <input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="Name, e.g. Kheri drainage" aria-label="Project name" className={`${field} h-10`} />
      <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="What it's about" aria-label="Description" className={`${field} py-2`} />
      <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={3} aria-label="Instructions for the chat"
        placeholder="What the chat should know or do here, e.g. Answer in Punjabi. The XEN is Harpal Singh. Track every promise to the sarpanches." className={`${field} py-2`} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-ghost h-8 px-3 text-[13px]">Cancel</button>
        <button type="submit" disabled={!name.trim()} className="btn btn-primary h-8 px-4 text-[13px]">{project ? "Save" : "Create"}</button>
      </div>
    </form>
  );
}

/** Pick existing notes to add: search (meaning, names, words) or the newest; tick and add. */
function NotePicker({ exclude, onAdd, onCancel, onNotice }: { exclude: string[]; onAdd: (ids: string[]) => void; onCancel: () => void; onNotice: (m: string) => void }) {
  const [q, setQ] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  useEffect(() => {
    const t = setTimeout(() => {
      const load = q.trim() ? api(`/search?q=${encodeURIComponent(q.trim())}`).then((r: { notes: Note[] }) => r.notes)
        : api("/notes?per=50").then((r: NotesPage) => r.items);
      load.then(ns => setNotes(ns.filter(n => !exclude.includes(n.id))), () => onNotice("Couldn't load notes."));
    }, 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (nid: string) => setChosen(c => { const x = new Set(c); if (x.has(nid)) x.delete(nid); else x.add(nid); return x; });
  return (
    <section className="card p-4 flex flex-col gap-2" style={{ borderRadius: 18 }}>
      <input value={q} onChange={e => setQ(e.target.value)} autoFocus placeholder="Find notes by meaning, name or word…" aria-label="Find notes"
        className="field h-9 px-3 text-[13.5px] bg-bg border border-line rounded-xl" />
      <div className="max-h-[320px] overflow-y-auto flex flex-col">
        {!notes.length && <p className="text-[13px] text-faint py-2">No notes to add.</p>}
        {notes.map(n => (
          <label key={n.id} className="flex items-start gap-2.5 py-2 cursor-pointer">
            <input type="checkbox" checked={chosen.has(n.id)} onChange={() => toggle(n.id)} className="mt-1" />
            <span className="min-w-0">
              <span className="block text-[14px] text-ink">{n.title || n.raw_text.slice(0, 60)}</span>
              <span className="block text-[12px] text-faint truncate">{day(n.created_at!)} · {n.raw_text.slice(0, 90)}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn btn-ghost h-8 px-3 text-[13px]">Cancel</button>
        <button onClick={() => onAdd(Array.from(chosen))} disabled={!chosen.size} className="btn btn-primary h-8 px-4 text-[13px]">Add {chosen.size || ""} {chosen.size === 1 ? "note" : "notes"}</button>
      </div>
    </section>
  );
}
