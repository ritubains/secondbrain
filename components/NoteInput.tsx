"use client";
// The capture box: type with formatting (components/RichEditor.tsx), or tap the mic and talk. A recording with
// nothing typed alongside is saved as it is and transcribed in the background (save-and-go).
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { I } from "./IconButton";
import RichEditor, { type RichEditorHandle } from "./RichEditor";
import Waveform from "./Waveform";

type Props = {
  draft: string;
  setDraft: (v: string) => void;
  onSave: () => void;
  busy: boolean;
  listening: boolean;
  transcribing: boolean;
  stream: MediaStream | null;
  onToggleSpeak: () => void;
  onCancelVoice: () => void;
};

const MIN = 64, MAX = 320;  // the editor grows with the note, then scrolls

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

const NoteInput = forwardRef<{ focus: () => void }, Props>(function NoteInput(
  { draft, setDraft, onSave, busy, listening, transcribing, stream, onToggleSpeak, onCancelVoice }, ref) {
  const ta = useRef<RichEditorHandle>(null);
  const [focus, setFocus] = useState(false);
  const [secs, setSecs] = useState(0);
  const voice = listening || transcribing;
  const open = focus || voice;
  useImperativeHandle(ref, () => ({ focus: () => ta.current?.focus() }), []);

  // Recording clock.
  useEffect(() => {
    if (!listening) return;
    setSecs(0);
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [listening]);

  // Esc cuts, like ChatGPT dictation.
  useEffect(() => {
    if (!voice) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onCancelVoice(); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [voice, onCancelVoice]);

  return (
    <div className={`rounded-2xl border bg-bg p-3 transition-[border-color,box-shadow] duration-200 ${open ? "border-primary shadow-[0_0_0_4px_var(--primary-100),0_6px_16px_-10px_rgb(var(--shadow)/.22)]" : "border-line hover:border-line-strong shadow-[0_4px_12px_-8px_rgb(var(--shadow)/.16)] hover:shadow-[0_6px_16px_-9px_rgb(var(--shadow)/.22)]"}`}>
      <label htmlFor="draft" className="sr-only">New note</label>
      <div className="relative">
        <div id="draft" className="px-1.5 pt-1 overflow-y-auto" style={{ maxHeight: MAX }} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}>
          <RichEditor ref={ta} value={draft} onChange={setDraft} onSubmit={onSave} readOnly={transcribing} toolbar={!voice} minHeight={MIN}
            placeholder={transcribing ? "" : listening ? "Listening. Keep talking, or type alongside…" : "What's on your mind? Type it, or tap the mic and say it. # heading, - list, [] checklist"} />
        </div>
        {transcribing && (
          // Skeleton lines where the transcript will land (after any existing draft text).
          <div className={`anim-fade px-1.5 flex flex-col gap-2 ${draft ? "pb-1" : "absolute inset-x-0 top-2"}`} aria-hidden>
            <div className="skeleton h-3 rounded-full w-[82%]" />
            <div className="skeleton h-3 rounded-full w-[58%]" />
          </div>
        )}
      </div>

      {voice ? (
        <div className="anim-fade flex items-center gap-3 pt-2" role="group" aria-label={transcribing ? "Transcribing" : "Recording"}>
          <button onClick={onCancelVoice} aria-label="Discard recording (Esc)" title="Discard (Esc)"
            className="btn h-10 w-10 rounded-full border border-line text-muted hover:text-danger hover:border-danger hover:bg-danger-50 shrink-0">
            {I.x}
          </button>
          <div className="flex-1 min-w-0 flex items-center gap-3">
            {transcribing ? (
              <p className="flex-1 flex items-center gap-2 text-[13px] text-primary font-medium" role="status">
                <span className="spinner !border-primary-100 !border-t-primary" aria-hidden />
                Transcribing…
              </p>
            ) : (
              <>
                <div className="flex-1 min-w-0"><Waveform stream={stream} active={listening} /></div>
                <span className="text-[12px] text-muted tabular-nums shrink-0" aria-live="off">{mmss(secs)}</span>
              </>
            )}
          </div>
          <button onClick={onToggleSpeak} disabled={transcribing} aria-label={draft.trim() ? "Stop and add to the note" : "Stop and save"} title={draft.trim() ? "Stop and add to the note" : "Stop and save. It's transcribed in the background"}
            className={`btn h-10 w-10 rounded-full shrink-0 ${transcribing ? "bg-primary-50 text-primary" : "btn-primary pulse"}`}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><rect width="12" height="12" rx="2.5" fill="currentColor" /></svg>
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 pt-2">
          <button onClick={onToggleSpeak} aria-label="Record a voice note"
            className="btn h-10 w-10 rounded-xl border border-line text-muted hover:text-primary hover:border-primary-100 hover:bg-primary-50">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="9" y="3" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.8" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <button onClick={onSave} disabled={busy || !draft.trim()}
            className="btn btn-primary h-10 px-4 text-[13.5px] ml-auto rounded-xl">
            {busy ? <><span className="spinner" aria-hidden />Saving</> : <>Save note {I.arrow}</>}
          </button>
        </div>
      )}
    </div>
  );
});

export default NoteInput;
