// Browser dictation (Web Speech API) — framework-free so page.tsx stays thin.
// No new deps; minimal local types since DOM lib lacks SpeechRecognition.

type SRInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SRResultEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SRResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

type SRCtor = new () => SRInstance;

// True when the browser has built-in speech recognition (Chrome/Safari, secure origin).
export function supported(): boolean {
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

// Dictate into the draft via the browser engine; merges interim + final transcripts.
export function createVoice(opts: {
  base: string;
  onText: (v: string) => void;
  onError: (code: string) => void;
  onEnd: () => void;
}): { start: () => void; stop: () => void } {
  const w = window as unknown as Record<string, unknown>;
  const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as SRCtor;
  const r = new Ctor();
  r.continuous = true;
  r.interimResults = true;
  r.lang = "en-IN";
  const base = opts.base.trim();
  let settled = "";
  r.onresult = e => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) settled += t + " ";
      else interim += t;
    }
    const spoken = (settled + interim).trim();
    opts.onText(base ? `${base} ${spoken}`.trim() : spoken);
  };
  r.onerror = e => opts.onError(e?.error || "unknown");
  r.onend = () => opts.onEnd();
  return { start: () => r.start(), stop: () => r.stop() };
}
