"use client";
// Recordings being transcribed in the background (save-and-go): a small pill in the corner of every screen, so you
// can carry on; it says when a recording couldn't be transcribed and offers Retry (the audio is kept).
export type VoiceJob = { id: string; state: "uploading" | "transcribing" | "failed"; error?: string };

export default function VoiceJobs({ jobs, onRetry, onDismiss }: { jobs: VoiceJob[]; onRetry: (id: string) => void; onDismiss: (id: string) => void }) {
  if (!jobs.length) return null;
  const working = jobs.filter(j => j.state !== "failed"), failed = jobs.filter(j => j.state === "failed");
  return (
    <div className="fixed z-40 right-4 bottom-20 lg:bottom-6 flex flex-col items-end gap-2" role="status" aria-live="polite">
      {working.length > 0 && (
        <div className="card anim-pop flex items-center gap-2.5 pl-3 pr-4 h-10 text-[13px] font-medium text-soft shadow-lg" style={{ borderRadius: 999 }}>
          <span className="spinner !border-primary-100 !border-t-primary" aria-hidden />
          {working.length === 1 ? (working[0].state === "uploading" ? "Saving your recording…" : "Transcribing your recording…")
            : `Transcribing ${working.length} recordings…`}
        </div>
      )}
      {failed.map(j => (
        <div key={j.id} className="card anim-pop flex items-center gap-2 pl-3 pr-1.5 h-10 text-[13px] shadow-lg" style={{ borderRadius: 999 }}>
          <span className="text-danger font-medium">{j.error === "no_speech" ? "No speech heard in that recording" : "Couldn't transcribe a recording"}</span>
          {j.error !== "no_speech" && j.error !== "upload" && <button onClick={() => onRetry(j.id)} className="btn btn-primary h-7 px-3 text-[12.5px] rounded-full">Retry</button>}
          <button onClick={() => onDismiss(j.id)} aria-label="Dismiss" className="w-7 h-7 rounded-full text-faint hover:text-soft">×</button>
        </div>
      ))}
    </div>
  );
}
