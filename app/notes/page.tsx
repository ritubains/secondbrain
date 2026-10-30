"use client";
// The app: Home, Notes, Chat, People, Projects and What I know about you, plus the capture sheet (record or type —
// a recording becomes text, then it's saved like any note), the note panel and the entity panel.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";
import { bucketOf } from "../../lib/buckets";
import { shown as shownText, tick } from "../../lib/checklist";
import type { Note, NotesPage, NoteStats, Project } from "../../lib/types";
import { useVoice } from "../../lib/useVoice";
import AppShell, { type View } from "../../components/AppShell";
import BucketChips from "../../components/BucketChips";
import CaptureSheet from "../../components/CaptureSheet";
import ChatView from "../../components/ChatView";
import EntityPanel from "../../components/EntityPanel";
import FolderView from "../../components/FolderView";
import GraphView, { type GraphTarget } from "../../components/GraphView";
import HomeView from "../../components/HomeView";
import { I } from "../../components/IconButton";
import MapView from "../../components/MapView";
import MemoryView from "../../components/MemoryView";
import { noteAnchor } from "../../components/NoteBoard";
import NoteDialog, { type NoteEdits } from "../../components/NoteDialog";
import NoteInput from "../../components/NoteInput";
import NotesView, { ModeSwitch, useMode } from "../../components/NotesView";
import Notice from "../../components/Notice";
import PeopleView from "../../components/PeopleView";
import ProjectsView from "../../components/ProjectsView";
import SortMenu, { type Sort } from "../../components/SortMenu";
import TopicBar from "../../components/TopicBar";
import VoiceJobs, { type VoiceJob } from "../../components/VoiceJobs";

const BATCH = 30; // notes per scroll batch
const ts = (n: Note) => (n.created_at ? new Date(n.created_at).getTime() : 0);
type NoteUpdate = Partial<Pick<Note, "raw_text" | "title" | "place" | "pinned" | "starred">> & { done?: boolean; project_id?: string };

export default function App() {
  const router = useRouter();
  const [view, setView] = useState<View>("home");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);            // screens refetch after a change
  const [email, setEmail] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<NoteStats>({ total: 0 });
  // What's open where: a note, an entity, a chat, a project.
  const [openId, setOpenId] = useState<string | null>(null);
  const [extra, setExtra] = useState<Note | null>(null);     // the open note when it isn't in the loaded list
  const [entityId, setEntityId] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [chatQuestion, setChatQuestion] = useState<string | null>(null);
  const [chatProject, setChatProject] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [graph, setGraph] = useState<GraphTarget | null>(null);  // the knowledge graph panel, centred on this
  // Capture: the draft, and the project a new note goes into.
  const [capture, setCapture] = useState<"voice" | "type" | null>(null);
  const [captureProject, setCaptureProject] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<{ focus: () => void }>(null);
  const [jobs, setJobs] = useState<VoiceJob[]>([]);                     // recordings transcribing in the background
  const voice = useVoice({ text, setText, onNotice: setNotice, onClip: (blob, mime, ms) => saveRecording(blob, mime, ms) });
  // The notes list.
  const [items, setItems] = useState<Note[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreErr, setMoreErr] = useState(false);
  const [pinnedNotes, setPinnedNotes] = useState<Note[]>([]);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set()); // saved/edited notes the pipeline is still reading
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<Note[] | null>(null); // search results; null = the stream
  const [searching, setSearching] = useState(false);
  const [bucket, setBucket] = useState<string | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);   // show one topic's notes
  const [sort, setSort] = useState<Sort>("new");
  const [mode, setMode] = useMode();
  const viewRef = useRef("");
  const moreCtl = useRef<AbortController | null>(null);
  const busyMore = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const listTop = useRef<HTMLDivElement>(null);

  // ---- session, theme, shared lists ------------------------------------------------------------------

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    api("/auth/me").then(r => setEmail(r?.email || null), () => {});
  }, []);
  useEffect(() => { api("/projects").then((r: { projects: Project[] }) => setProjects(r.projects), () => {}); }, [reloadKey]);

  /** 401 anywhere (stale cookie) → back to login. */
  const authFail = (e: { status?: number }) => {
    if (e?.status === 401) { router.push("/login?next=/notes"); return true; }
    return false;
  };
  const loadStats = () => api("/notes/stats").then((r: NoteStats) => setStats(r), (e: { status?: number }) => { authFail(e); });
  useEffect(() => { loadStats(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** After any change: counts, and every screen's data. */
  const reload = () => { setReloadKey(k => k + 1); loadStats(); };
  /** After notes change, the AI files them again in the background: once the API says it has finished, reload, so the
   * mind map, map and folders show where things went. */
  const reloadWhenFiled = () => { api("/filing/done").then(reload, () => {}); };

  const toggleTheme = () => setTheme(t => {
    const next = t === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", next); } catch { /* storage blocked */ }
    document.documentElement.dataset.theme = next;
    return next;
  });
  const logout = async () => {
    voice.stopAll();
    try { await api("/auth/logout", { method: "POST", body: "{}" }); } finally { router.push("/login"); }
  };
  const go = (v: View) => { setView(v); window.scrollTo({ top: 0 }); };

  // ---- the notes list: batches, search, buckets --------------------------------------------------------

  const qRaw = query.trim();
  const scoped = !!qRaw; // searching: results come from /search, not the stream
  const viewKey = `${sort}|${bucket ?? ""}|${topicId ?? ""}`;
  const live = useRef({ sort, bucket, topicId, hasMore }); // for callbacks that outlive the render they started in
  live.current = { sort, bucket, topicId, hasMore };

  // The first batch whenever sort or bucket changes.
  useEffect(() => {
    const ctl = new AbortController();
    viewRef.current = viewKey;
    moreCtl.current?.abort(); moreCtl.current = null; busyMore.current = false;
    setLoadingMore(false); setMoreErr(false); setListLoading(true);
    const qs = new URLSearchParams({ per: String(BATCH), sort, ...(bucket ? { bucket } : {}), ...(topicId ? { topic_id: topicId } : {}) });
    api(`/notes?${qs}`, { signal: ctl.signal }).then(
      (r: NotesPage) => { if (ctl.signal.aborted) return; setListLoading(false); setItems(r.items); setCursor(r.next_cursor ?? null); setHasMore(!!r.next_cursor); },
      (e: { status?: number }) => {
        if (ctl.signal.aborted) return;
        setListLoading(false); setItems([]); setHasMore(false);
        if (!authFail(e)) setNotice("Could not reach the API. Start it and reload.");
      },
    );
    return () => ctl.abort();
  }, [viewKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The next batch, appended (dropped if the view changed meanwhile). */
  const loadMore = () => {
    const key = viewKey;
    if (busyMore.current || !hasMore || !cursor || key !== viewRef.current) return;
    busyMore.current = true; setLoadingMore(true); setMoreErr(false);
    const ctl = new AbortController();
    moreCtl.current = ctl;
    const qs = new URLSearchParams({ per: String(BATCH), sort, cursor, ...(bucket ? { bucket } : {}), ...(topicId ? { topic_id: topicId } : {}) });
    api(`/notes?${qs}`, { signal: ctl.signal }).then(
      (r: NotesPage) => {
        if (ctl.signal.aborted || key !== viewRef.current) return;
        setItems(prev => { const have = new Set(prev.map(n => n.id)); return [...prev, ...r.items.filter(n => !have.has(n.id))]; });
        const next = r.items.length ? r.next_cursor ?? null : null;
        setCursor(next); setHasMore(!!next);
      },
      (e: { status?: number }) => { if (!ctl.signal.aborted && !authFail(e)) setMoreErr(true); },
    ).finally(() => { if (moreCtl.current === ctl) { moreCtl.current = null; busyMore.current = false; setLoadingMore(false); } });
  };

  // Load more as the end of the list comes near.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loadingMore || moreErr || listLoading || scoped || view !== "notes") return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) loadMore(); }, { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadingMore, moreErr, listLoading, scoped, view, cursor, items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pinned notes sit on top, whatever batch the list is on.
  useEffect(() => {
    if (view === "notes") api("/notes?per=50&pinned=true").then((r: NotesPage) => setPinnedNotes(r.items), () => {});
  }, [view, reloadKey]);

  // Search: meaning, entities and words, a moment after typing stops.
  useEffect(() => {
    setRemote(null);
    if (!qRaw) { setSearching(false); return; }
    setSearching(true);
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try { const r = await api(`/search?q=${encodeURIComponent(qRaw)}`, { signal: ctl.signal }); setRemote(r.notes); }
      catch { if (!ctl.signal.aborted) setRemote([]); }
      if (!ctl.signal.aborted) setSearching(false);
    }, 250);
    return () => { ctl.abort(); clearTimeout(t); };
  }, [qRaw]);

  const toListTop = () => { if (listTop.current && listTop.current.getBoundingClientRect().top < 0) listTop.current.scrollIntoView({ block: "start" }); };
  /** Update a note wherever it's shown. */
  const patchLocal = (id: string, patch: Partial<Note>) => {
    const f = (ns: Note[]) => ns.map(n => (n.id === id ? { ...n, ...patch } : n));
    setItems(f); setRemote(r => (r ? f(r) : r)); setPinnedNotes(f);
    setExtra(x => (x && x.id === id ? { ...x, ...patch } : x));
  };
  const dropLocal = (id: string) => { setItems(ns => ns.filter(n => n.id !== id)); setRemote(r => (r ? r.filter(n => n.id !== id) : r)); };

  /** Keep a note's place in the loaded list in step with the bucket / topic filter and sort. */
  const reconcile = (n: Note) => {
    const { sort, bucket, topicId, hasMore } = live.current;
    const fits = (!bucket || bucketOf(n.bucket) === bucket) && (!topicId || !!n.topics?.some(t => t.id === topicId));
    setItems(prev => {
      const at = prev.findIndex(x => x.id === n.id);
      if (!fits) return at < 0 ? prev : prev.filter(x => x.id !== n.id);
      if (at >= 0) return prev.map(x => (x.id === n.id ? { ...x, ...n } : x));
      const i = prev.findIndex(x => (sort === "new" ? ts(x) < ts(n) : ts(x) > ts(n)));
      if (i < 0) return hasMore ? prev : [...prev, n];
      return [...prev.slice(0, i), n, ...prev.slice(i)];
    });
  };

  // ---- capture and save --------------------------------------------------------------------------------

  /** Record: open the sheet and start listening in the same tap (browsers only allow the mic on a click). */
  const startRecord = (project: string | null = null) => {
    setCaptureProject(project); setCapture("voice");
    if (!voice.listening && !voice.transcribing) voice.toggle();
  };
  const startTyping = (project: string | null = null) => { setCaptureProject(project); setCapture("type"); };
  useEffect(() => { if (capture === "type") requestAnimationFrame(() => input.current?.focus()); }, [capture]);
  // N anywhere (not while typing) opens the sheet to type.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key.toLowerCase() !== "n" || e.metaKey || e.ctrlKey || e.altKey || capture) return;
      if (t.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      e.preventDefault(); startTyping(view === "projects" ? projectId : null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [capture, view, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Save the draft — typed or transcribed, the same request. The pipeline runs after; watch for it. */
  const save = async () => {
    if (!text.trim() || busy || !voice.readyToSave()) return;
    setBusy(true); setNotice("");
    try {
      const clips = voice.clips();
      const n: Note & { did?: string[] } = await api("/notes", { method: "POST", body: JSON.stringify({
        raw_text: text, source: clips.length ? "voice" : "typed", recording_ids: clips, project_id: captureProject }) });
      voice.saved();
      setText(""); setCapture(null); setQuery("");
      // An instruction ("create project X and put this note in it") was carried out: say what was done.
      const did = n.did?.length ? `${n.did.join(". ")}.` : "";
      if (!n.id) { setNotice(did || "Done."); reload(); return; }
      setNotice(did ? `${did} The note is being read and connected.` : "Saved. It's being read and connected.");
      if (did) reload();
      reconcile(n);
      setStats(st => ({ ...st, total: st.total + 1 }));
      setRefreshing(r => new Set(r).add(n.id));
      watch(n.id);
    } catch {
      setNotice("Save failed. Is the API running?");
    } finally { setBusy(false); }
  };

  /** Save-and-go: the recording is saved now and transcribed in the background; the sheet gets out of the way and
   * the note shows up when it's ready (or what a spoken instruction did is said). */
  const saveRecording = async (blob: Blob, mime: string, ms: number) => {
    const project = captureProject;
    setCapture(null); setText(""); setNotice("");
    const tmp = `up-${Date.now()}`;
    setJobs(j => [...j, { id: tmp, state: "uploading" }]);
    const fd = new FormData();
    fd.append("audio", blob, `note.${mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm"}`);
    fd.append("duration_ms", String(ms));
    if (project) fd.append("project_id", project);
    try {
      const r = await api("/voice/notes", { method: "POST", body: fd });
      setJobs(j => j.map(x => (x.id === tmp ? { id: r.recording_id, state: "transcribing" } : x)));
      follow(r.recording_id);
    } catch {
      setJobs(j => j.map(x => (x.id === tmp ? { ...x, state: "failed", error: "upload" } : x)));
    }
  };
  /** Poll a background recording until its note is saved (then read like any new note). */
  const follow = (rid: string) => {
    const tick = async () => {
      const r = await api(`/voice/jobs/${rid}`).catch((e: { status?: number }) => (e?.status === 404 ? { state: "gone" } : null));
      if (!r || r.state === "transcribing") { setTimeout(tick, 1200); return; }
      if (r.state === "failed") { setJobs(j => j.map(x => (x.id === rid ? { ...x, state: "failed", error: r.error } : x))); return; }
      setJobs(j => j.filter(x => x.id !== rid));
      const did = r.did?.length ? `${r.did.join(". ")}.` : "";
      if (!r.note_id) { setNotice(did || "Done."); reload(); return; }
      setNotice(did ? `${did} Your recording is saved.` : "Your recording is saved. It's being read and connected.");
      const n: Note | null = await api(`/notes/${r.note_id}`).catch(() => null);
      if (n) { reconcile(n); setStats(st => ({ ...st, total: st.total + 1 })); setRefreshing(x => new Set(x).add(n.id)); watch(n.id); }
      if (did) reload();
    };
    setTimeout(tick, 900);
  };
  /** A recording that failed to transcribe: try again from the kept audio, then save it like a typed note. */
  const retryRecording = async (rid: string) => {
    setJobs(j => j.map(x => (x.id === rid ? { id: rid, state: "transcribing" } : x)));
    try {
      const r = await api(`/voice/recordings/${rid}/retry`, { method: "POST", body: "{}" });
      const t = (r?.transcript || "").trim();
      if (!t) { setJobs(j => j.map(x => (x.id === rid ? { ...x, state: "failed", error: "no_speech" } : x))); return; }
      const n: Note & { did?: string[] } = await api("/notes", { method: "POST", body: JSON.stringify({ raw_text: t, source: "voice", recording_ids: [rid] }) });
      setJobs(j => j.filter(x => x.id !== rid));
      setNotice(n.did?.length ? `${n.did.join(". ")}.` : "Your recording is saved. It's being read and connected.");
      if (n.id) { reconcile(n); setRefreshing(x => new Set(x).add(n.id)); watch(n.id); } else reload();
    } catch {
      setJobs(j => j.map(x => (x.id === rid ? { ...x, state: "failed" } : x)));
    }
  };

  /** Poll a note until the pipeline has read it, then refresh it and every screen. */
  const watch = (id: string) => {
    let tries = 0;
    const tick = async () => {
      tries++;
      let gone = false;
      const n: Note | null = await api(`/notes/${id}`).catch((e: { status?: number }) => { gone = e?.status === 404; return null; });
      const finished = gone || (n && n.enrich_state !== "pending") || tries >= 40;
      if (n) { patchLocal(id, n); reconcile(n); }
      if (gone) dropLocal(id);
      if (finished) { setRefreshing(r => { const x = new Set(r); x.delete(id); return x; }); reload(); reloadWhenFiled(); return; }
      setTimeout(tick, 1500);
    };
    setTimeout(tick, 1500);
  };

  // ---- note actions -----------------------------------------------------------------------------------

  /** Change a note: show it at once, save, and put the server's version back if that fails. */
  const mutate = async (id: string, body: NoteUpdate, patch: Partial<Note>, fail: string) => {
    patchLocal(id, patch);
    const rereads = body.raw_text !== undefined; // new text: the pipeline reads it again
    if (rereads) setRefreshing(r => new Set(r).add(id));
    try {
      const fresh: Note = await api(`/notes/${id}`, { method: "PUT", body: JSON.stringify(body) });
      patchLocal(id, fresh); reconcile(fresh);
      if (rereads) watch(id); else reload();
    } catch {
      if (rereads) setRefreshing(r => { const x = new Set(r); x.delete(id); return x; });
      setNotice(fail);
      api(`/notes/${id}`).then((n: Note) => { patchLocal(id, n); reconcile(n); }, (e: { status?: number }) => { if (e?.status === 404) dropLocal(id); });
    }
  };

  const findNote = (id: string) => items.find(n => n.id === id) || remote?.find(n => n.id === id) || pinnedNotes.find(n => n.id === id);
  const togglePin = (id: string) => {
    const n = findNote(id);
    if (!n) return;
    setPinnedNotes(ps => (!n.pinned ? [{ ...n, pinned: true }, ...ps] : ps.filter(x => x.id !== id)));
    mutate(id, { pinned: !n.pinned }, { pinned: !n.pinned }, "Couldn't pin that. Is the API running?");
  };
  const toggleStar = (id: string) => {
    const n = findNote(id);
    if (n) mutate(id, { starred: !n.starred }, { starred: !n.starred }, "Couldn't star that. Is the API running?");
  };
  /** Tick a checklist item in a note: shown at once, saved without the note being read again. */
  const checkItem = (id: string, index: number, done: boolean) => {
    const n = findNote(id);
    if (!n) return;
    const field = n.formatted ? "formatted" : "raw_text";
    patchLocal(id, { [field]: tick(shownText(n), index, done) });
    api(`/notes/${id}/check`, { method: "PATCH", body: JSON.stringify({ index, done }) })
      .then((saved: Note) => patchLocal(id, saved), () => { patchLocal(id, { [field]: shownText(n) }); setNotice("Couldn't save that tick. Is the API running?"); });
  };
  const toggleDone = (id: string) => {
    const n = findNote(id);
    if (n) mutate(id, { done: !n.done_at }, { done_at: n.done_at ? null : new Date().toISOString() }, "Couldn't update that. Is the API running?");
  };
  const copyNote = async (id: string) => {
    const n = findNote(id);
    if (!n) return;
    try { await navigator.clipboard.writeText(n.raw_text); setNotice("Note text copied."); }
    catch { setNotice("Couldn't copy. Your browser blocked clipboard access."); }
  };
  const remove = async (id: string) => {
    if (openId === id) setOpenId(null);
    dropLocal(id);
    try { await api(`/notes/${id}`, { method: "DELETE" }); } catch { setNotice("Couldn't delete. Is the API running?"); }
    reload();
    reloadWhenFiled();
  };

  /** Open the note panel with the full note (entities, items, connected notes, clips). */
  const openNote = (id: string) => {
    setOpenId(id);
    api(`/notes/${id}`).then(
      (n: Note) => (findNote(id) ? patchLocal(id, n) : setExtra(n)),
      () => { setOpenId(null); setNotice("That note no longer exists."); },
    );
  };
  const dialogNote = openId ? (findNote(openId) || (extra?.id === openId ? extra : null)) : null;

  /** Note panel closed (or a connected note opened): save title/text edits, then go on. */
  const closeNote = (edits: NoteEdits, next?: string) => {
    const id = openId;
    if (id && (edits.title !== undefined || edits.raw_text !== undefined)) mutate(id, edits, { ...edits }, "Couldn't save the edit. Is the API running?");
    if (next) { openNote(next); return; }
    setOpenId(null);
    if (id) requestAnimationFrame(() => document.getElementById(noteAnchor(id))?.focus({ preventScroll: true }));
  };

  // ---- moving between screens --------------------------------------------------------------------------

  const askInChat = (question: string) => { setChatId(null); setChatProject(null); setChatQuestion(question); go("chat"); };
  const openChat = (id: string) => { setChatId(id); go("chat"); };
  const chatInProject = (pid: string) => { setChatId(null); setChatProject(pid); go("chat"); };
  const openProject = (id: string | null) => { setProjectId(id); go("projects"); };
  const searchNotes = (q: string) => { setQuery(q); go("notes"); };
  const openTopic = (id: string) => { setQuery(""); setBucket(null); setTopicId(id); if (mode === "folders") setMode("grid"); go("notes"); };

  const shown = scoped ? (remote ?? []).filter(n => !bucket || bucketOf(n.bucket) === bucket) : items;
  const empty = (title: string, body: string, cta?: boolean) => (
    <div className="anim-enter rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
      <h2 className="text-[18px]">{title}</h2>
      <p className="text-sm text-muted mt-1.5 max-w-sm mx-auto">{body}</p>
      {cta && <button onClick={() => startTyping()} className="btn btn-primary h-9 px-4 text-[13px] mt-5">Write your first note</button>}
    </div>
  );

  return (
    <div data-theme={theme} className="min-h-screen text-ink" style={{ background: "var(--page)" }}>
      <AppShell view={view} onView={go} onRecord={() => startRecord(view === "projects" ? projectId : null)} onType={() => startTyping(view === "projects" ? projectId : null)}
        noteCount={stats.total} theme={theme} onToggleTheme={toggleTheme} email={email} onLogout={logout}>
        {notice && <Notice text={notice} onDismiss={() => setNotice("")}
          action={voice.retryId ? { label: voice.transcribing ? "Retrying…" : "Retry", onClick: voice.retry, disabled: voice.transcribing } : undefined} />}

        {view === "home" ? (
          <HomeView reloadKey={reloadKey} onAsk={askInChat} onOpenChat={openChat} onOpenNote={openNote} onOpenEntity={setEntityId}
            onOpenProject={openProject} onShowProjects={() => openProject(null)} onShowMap={() => go("map")} onSearch={searchNotes} onOpenTopic={openTopic}
            onRecord={() => startRecord()} onType={() => startTyping()} onNotice={setNotice} />
        ) : view === "chat" ? (
          <ChatView reloadKey={reloadKey} openId={chatId} firstQuestion={chatQuestion} projectId={chatProject}
            onOpenNote={openNote} onConsumed={() => setChatQuestion(null)} onNotice={setNotice} />
        ) : view === "people" ? (
          <PeopleView reloadKey={reloadKey} onOpenEntity={setEntityId} onNotice={setNotice} onChanged={reload} />
        ) : view === "projects" ? (
          <ProjectsView reloadKey={reloadKey} openId={projectId} onOpen={openProject} onOpenNote={openNote}
            onAddNote={pid => startTyping(pid)} onChat={chatInProject} onOpenChat={openChat} onNotice={setNotice} />
        ) : view === "map" ? (
          <MapView reloadKey={reloadKey} onOpenNote={openNote} onOpenEntity={setEntityId} />
        ) : view === "memory" ? (
          <MemoryView reloadKey={reloadKey} onOpenNote={openNote} onNotice={setNotice} />
        ) : (
          <>
            <div ref={listTop} className="scroll-anchor flex flex-wrap items-center gap-2 mb-4">
              <h1 className="font-display text-[26px] font-semibold tracking-tight mr-2 hidden md:block">Notes</h1>
              <div className="relative flex-1 basis-full sm:basis-auto min-w-0 sm:max-w-[460px]">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none">{I.search}</span>
                <input value={query} onChange={e => setQuery(e.target.value)} aria-label="Search notes" placeholder="Search by meaning, name or word…"
                  onKeyDown={e => { if (e.key === "Escape") setQuery(""); }}
                  className="field w-full h-9 pl-9 pr-8 text-[13.5px] bg-bg border border-line rounded-xl placeholder:text-faint" />
                {query && <button onClick={() => setQuery("")} aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md flex items-center justify-center text-faint hover:text-soft">{I.x}</button>}
              </div>
              <div className="shrink-0 ml-auto flex items-center gap-2"><ModeSwitch mode={mode} onMode={setMode} /><SortMenu sort={sort} onSort={v => { setSort(v); toListTop(); }} /></div>
            </div>
            {!scoped && mode !== "folders" && <TopicBar reloadKey={reloadKey} activeId={topicId} onPick={id => { setTopicId(id); toListTop(); }} onGraph={id => setGraph({ kind: "topic", id })}
              onOpenEntity={setEntityId} onOpenProject={openProject} onChanged={reload} onNotice={setNotice} />}
            {!scoped && stats.total > 0 && !!stats.bucket_names?.length && (
              <div className="-mt-1 mb-4"><BucketChips names={stats.bucket_names} counts={stats.buckets || {}} active={bucket}
                onPick={b => { setBucket(b); toListTop(); }} /></div>
            )}
            {mode === "folders" ? (
              <FolderView reloadKey={reloadKey} query={query} bucket={bucket} onOpenNote={openNote} onOpenTopic={openTopic} onOpenEntity={setEntityId} />
            ) : (!scoped && listLoading) || (scoped && searching && !shown.length) ? (
              <div className="columns-1 min-[560px]:columns-2 min-[860px]:columns-3 gap-3" aria-busy="true">
                {[120, 180, 96, 150, 200, 110].map((h, i) => <div key={i} className="skeleton rounded-xl mb-3 break-inside-avoid" style={{ height: h }} />)}
              </div>
            ) : !scoped && !bucket && !topicId && !items.length && !hasMore ? (
              empty("No notes yet", "Tap Record and say what's on your mind, or type it. Each note is read, filed and connected to the rest.", true)
            ) : !shown.length ? (
              empty("No notes found", scoped ? `Nothing matches "${qRaw}".` : topicId ? "No notes in this topic." : `Nothing in ${bucket} yet.`)
            ) : (
              <>
                <NotesView key={`${bucket ?? ""}|${topicId ?? ""}|${sort}|${scoped ? "q" : ""}`} mode={mode} notes={shown}
                  pinned={!scoped && !bucket && !topicId && sort === "new" ? pinnedNotes : []} grouped={!scoped && sort === "new"}
                  batch={BATCH} highlightIds={scoped ? shown.map(n => n.id) : null} refreshing={refreshing}
                  onOpen={openNote} onCopy={copyNote} onDelete={remove} onTogglePin={togglePin} onToggleStar={toggleStar} onCheck={checkItem} onToggleDone={toggleDone} />
                {!scoped && (
                  <div ref={sentinel} className="mt-6 min-h-px">
                    {loadingMore ? <div className="skeleton rounded-xl h-[120px]" aria-busy="true" />
                      : moreErr ? <p className="text-center text-[13px] text-muted">Couldn't load more notes. <button onClick={loadMore} className="btn btn-ghost h-8 px-3 text-[13px]">Retry</button></p>
                      : !hasMore && items.length > BATCH ? <p className="text-center text-xs text-faint">That's all {items.length} notes.</p> : null}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </AppShell>

      <VoiceJobs jobs={jobs} onRetry={retryRecording} onDismiss={id => setJobs(j => j.filter(x => x.id !== id))} />
      <CaptureSheet open={!!capture} recording={voice.listening || voice.transcribing} onClose={() => setCapture(null)}>
        {captureProject && <p className="text-[12.5px] text-muted mb-2">Into project: <b className="text-soft">{projects.find(p => p.id === captureProject)?.name}</b></p>}
        <NoteInput ref={input} draft={text} setDraft={setText} onSave={save} busy={busy}
          listening={voice.listening} transcribing={voice.transcribing} stream={voice.micStream}
          onToggleSpeak={voice.toggle} onCancelVoice={voice.cancel} />
      </CaptureSheet>
      {dialogNote && (
        <NoteDialog key={dialogNote.id} note={dialogNote} projects={projects}
          refreshing={refreshing.has(dialogNote.id)} onDone={closeNote}
          onToggleStar={() => toggleStar(dialogNote.id)}
          onSetPlace={pl => mutate(dialogNote.id, { place: pl }, { place: pl }, "Couldn't save the place. Is the API running?")}
          onSetProject={pid => mutate(dialogNote.id, { project_id: pid }, { project_id: pid || null }, "Couldn't move it. Is the API running?")}
          onDelete={() => remove(dialogNote.id)} onOpenEntity={setEntityId} onOpenTopic={id => { closeNote({}); openTopic(id); }}
          onTopicsChanged={() => { openNote(dialogNote.id); reload(); }} onNotice={setNotice}
          onGraph={() => setGraph({ kind: "note", id: dialogNote.id })} />
      )}
      <EntityPanel entityId={entityId} reloadKey={reloadKey} onClose={() => setEntityId(null)} onOpenEntity={setEntityId}
        onOpenNote={openNote} onChanged={reload} onNotice={setNotice} onGraph={id => setGraph({ kind: "entity", id })} />
      <GraphView start={graph} onClose={() => setGraph(null)} onOpenNote={openNote} onOpenEntity={setEntityId}
        onOpenTopic={id => { setOpenId(null); setEntityId(null); openTopic(id); }} />
    </div>
  );
}
