"use client";
// Chat with your notes: ask in plain language, get an answer with the notes it came from (tap one to open it).
// Conversations are saved, so you can come back and continue; a chat inside a project uses its instructions.
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { ago, day } from "../lib/format";
import type { Conversation, ConversationSummary, Message, Project } from "../lib/types";
import IconButton, { I } from "./IconButton";

type Props = {
  reloadKey: number;
  openId: string | null;              // a conversation to show
  firstQuestion: string | null;       // a question asked from Home: start a chat with it
  projectId: string | null;           // a new chat goes in this project
  onOpenNote: (id: string) => void;
  onConsumed: () => void;             // the page clears firstQuestion once it's sent
  onNotice: (msg: string) => void;
};

export default function ChatView({ reloadKey, openId, firstQuestion, projectId, onOpenNote, onConsumed, onNotice }: Props) {
  const [list, setList] = useState<ConversationSummary[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [current, setCurrent] = useState<Conversation | null>(null);
  const [project, setProject] = useState<string | null>(projectId);   // for a new chat
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const loadList = () => api("/conversations").then((r: { conversations: ConversationSummary[] }) => setList(r.conversations), () => {});
  useEffect(() => {
    loadList();
    api("/projects").then((r: { projects: Project[] }) => setProjects(r.projects), () => {});
  }, [reloadKey]);
  useEffect(() => { if (openId) open(openId); }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setProject(projectId); }, [projectId]);
  useEffect(() => {
    if (firstQuestion) { setCurrent(null); send(firstQuestion, null); onConsumed(); }
  }, [firstQuestion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [current?.messages.length, thinking]);

  /** Show a saved conversation. */
  const open = (id: string) => api(`/conversations/${id}`).then(setCurrent, () => onNotice("That conversation is gone."));

  /** Ask: show the question at once, then the answer with its notes. */
  const send = async (text: string, conv: Conversation | null = current) => {
    const message = text.trim();
    if (!message || thinking) return;
    setDraft("");
    setThinking(true);
    const shown: Conversation = conv || { id: "", title: message, project_id: project, messages: [] };
    setCurrent({ ...shown, messages: [...shown.messages, { role: "user", content: message, notes: [] }] });
    try {
      const r = await api("/chat", { method: "POST", body: JSON.stringify({ message, conversation_id: conv?.id || null, project_id: conv ? null : project }) });
      setCurrent(c => ({ ...(c || shown), id: r.conversation.id, title: r.conversation.title, project_id: r.conversation.project_id,
        messages: [...(c || shown).messages, { role: "assistant", content: r.answer, notes: r.notes } as Message] }));
      loadList();
    } catch {
      onNotice("Couldn't get an answer. Is the API running?");
    } finally { setThinking(false); }
  };

  const remove = async (id: string) => {
    setList(l => l.filter(c => c.id !== id));
    if (current?.id === id) setCurrent(null);
    try { await api(`/conversations/${id}`, { method: "DELETE" }); } catch { onNotice("Couldn't delete that conversation."); }
  };

  const projectName = (id: string | null) => projects.find(p => p.id === id)?.name;

  return (
    <div className="anim-fade grid gap-4 lg:grid-cols-[260px_1fr] min-h-[70vh]">
      <aside className="flex flex-col gap-2 order-2 lg:order-1">
        <button onClick={() => setCurrent(null)} className="btn btn-primary h-9 text-[13.5px] gap-1.5">{I.plus} New chat</button>
        <p className="text-[11.5px] font-semibold uppercase tracking-[.06em] text-faint mt-2">Conversations</p>
        {!list.length && <p className="text-[13px] text-faint">Your chats are kept here, so you can pick one up later.</p>}
        {list.map(c => (
          <div key={c.id} className={`group flex items-center gap-1 rounded-xl px-2.5 py-2 ${current?.id === c.id ? "bg-primary-50" : "hover:bg-surface"}`}>
            <button onClick={() => open(c.id)} className="flex-1 min-w-0 text-left">
              <span className="block text-[13.5px] text-ink truncate">{c.title}</span>
              <span className="block text-[11.5px] text-faint truncate">{c.project ? `${c.project} · ` : ""}{ago(c.updated_at)}</span>
            </button>
            <IconButton label="Delete conversation" tone="danger" size={26} onClick={() => remove(c.id)} className="opacity-0 group-hover:opacity-100">{I.trash}</IconButton>
          </div>
        ))}
      </aside>

      <section className="card flex flex-col order-1 lg:order-2 min-h-[60vh]" style={{ borderRadius: 20 }}>
        <header className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line">
          <h1 className="font-display text-[18px] font-semibold truncate flex-1 min-w-0">{current?.title || "Ask your notes"}</h1>
          {current?.id ? (projectName(current.project_id) && <span className="text-[12.5px] text-muted">in {projectName(current.project_id)}</span>) : (
            <select value={project || ""} onChange={e => setProject(e.target.value || null)} aria-label="Project for this chat"
              className="field h-8 px-2 text-[13px] bg-bg border border-line rounded-lg">
              <option value="">All notes</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {!current?.messages.length && (
            <div className="m-auto text-center max-w-md">
              <p className="text-[15px] text-soft">Ask anything about your notes: what you promised, who raised what, what happened where.</p>
              <p className="text-[13px] text-faint mt-1">Answers come from your notes, and show which ones.</p>
            </div>
          )}
          {current?.messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "self-end max-w-[85%]" : "self-start max-w-[92%]"}>
              <div className={`rounded-2xl px-3.5 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-white" : "bg-surface text-ink"}`}>{m.content}</div>
              {!!m.notes.length && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {m.notes.map(n => (
                    <button key={n.id} onClick={() => onOpenNote(n.id)} title={n.why || ""}
                      className="chip-lift text-left rounded-lg border border-line px-2.5 py-1.5 hover:border-line-strong max-w-[240px]">
                      <span className="block text-[12.5px] text-ink truncate">{n.title || n.raw_text.slice(0, 40)}</span>
                      <span className="block text-[11px] text-faint truncate">{day(n.created_at!)}{n.why ? ` · ${n.why}` : ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {thinking && <div className="self-start rounded-2xl px-3.5 py-2.5 bg-surface text-[14px] text-muted" role="status">Reading your notes<span className="pulse">…</span></div>}
          <div ref={end} />
        </div>

        <form onSubmit={e => { e.preventDefault(); send(draft); }} className="flex gap-2 p-3 border-t border-line">
          <input value={draft} onChange={e => setDraft(e.target.value)} placeholder={current?.messages.length ? "Ask a follow-up…" : "Ask your notes…"}
            aria-label="Your question" className="field flex-1 min-w-0 h-11 px-3.5 text-[14px] bg-bg border border-line rounded-xl placeholder:text-faint" />
          <button type="submit" disabled={!draft.trim() || thinking} className="btn btn-primary h-11 w-11 rounded-xl" aria-label="Send">{I.arrow}</button>
        </form>
      </section>
    </div>
  );
}
