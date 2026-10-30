"use client";
// Capture: a focused sheet for a new thought — opened by Record (starts listening right away) or Type.
// Nothing else on screen competes with it; Save files it and the sheet gets out of the way.
import { useEffect } from "react";
import { I } from "./IconButton";

type Props = {
  open: boolean;
  recording: boolean;      // listening or transcribing — closing would lose it, so Esc is left to the recorder
  onClose: () => void;
  children: React.ReactNode;
};

export default function CaptureSheet({ open, recording, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !recording) onClose(); };
    window.addEventListener("keydown", key);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", key); };
  }, [open, recording, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6 anim-fade"
      style={{ background: "rgb(var(--shadow) / .42)", backdropFilter: "blur(3px)" }}
      onMouseDown={e => { if (e.target === e.currentTarget && !recording) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="New thought"
        className="anim-pop w-full sm:max-w-[620px] bg-bg border border-line rounded-t-3xl sm:rounded-3xl p-4 sm:p-6 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_30px_80px_-30px_rgb(var(--shadow)/.6)]">
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-1">
            <h2 className="font-display text-[20px] font-semibold tracking-tight">What's on your mind?</h2>
            <p className="text-[13px] text-muted mt-0.5">A conversation, a request, a promise, an idea. Just say it. No titles, no folders.</p>
          </div>
          <button onClick={onClose} disabled={recording} aria-label="Close"
            className="btn w-9 h-9 rounded-full text-muted hover:text-ink hover:bg-surface disabled:opacity-30 shrink-0">{I.x}</button>
        </div>
        {children}
        <p className="text-[12px] text-faint mt-3 hidden sm:block">
          <kbd className="kbd">⌘</kbd> <kbd className="kbd">↵</kbd> to save · <kbd className="kbd">Esc</kbd> to {recording ? "stop recording" : "close"}
        </p>
      </div>
    </div>
  );
}
