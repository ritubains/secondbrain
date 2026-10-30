// Voice capture: speech → text in the draft. After this a recording is just text: Save posts it like a typed note.
// With onClip, a finished recording (nothing typed alongside) is handed over whole instead — the page saves it and
// it's transcribed in the background (save-and-go).
// Three ways to listen, best first (picked once from GET /voice/status):
//   wispr    live streaming transcription
//   whisper  record, then upload: the server stores the clip and transcribes it with the user's spelling hints
//   browser  the browser's own dictation (no server)
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { createVoice, supported as browserSupported } from "./voice";
import { createWisprVoice, supported as wisprSupported } from "./voice-wispr";

type Options = {
  text: string;                                   // the current draft
  setText: (t: string | ((cur: string) => string)) => void;
  onNotice: (msg: string) => void;
  onClip?: (blob: Blob, mime: string, durationMs: number) => void;  // save-and-go: take the finished recording
};

export function useVoice({ text, setText, onNotice, onClip }: Options) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null); // feeds the waveform
  const [retryId, setRetryId] = useState<string | null>(null);           // a clip saved but not transcribed
  const tier = useRef<null | "wispr" | "whisper" | "browser">(null);
  const live = useRef<{ stop: () => void } | null>(null);   // wispr or browser session
  const recorder = useRef<MediaRecorder | null>(null);       // whisper tier
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const clipIds = useRef<string[]>([]);                      // stored clips behind the draft, linked on Save
  const before = useRef("");                                 // the draft before recording, restored on Cancel
  const discarded = useRef(false);
  const upload = useRef<AbortController | null>(null);

  // A draft cleared by hand forgets its clips (never linked; the prune job sweeps them).
  useEffect(() => {
    if (!text.trim() && !listening && !transcribing) clipIds.current = [];
  }, [text, listening, transcribing]);

  /** Stop live listening (wispr / browser) without touching a recording. */
  const stopLive = () => {
    try { live.current?.stop(); } catch { /* already stopped */ }
    live.current = null;
    if (!recorder.current) setListening(false);
  };

  /** Stop the recorder; transcribe=true uploads the audio and puts the transcript in the draft. */
  const stopRecorder = (transcribe: boolean) => {
    const mr = recorder.current;
    recorder.current = null;
    if (!mr) return;
    setMicStream(null);
    mr.onstop = () => {
      try { mr.stream.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
      setListening(false);
      if (!transcribe || discarded.current) return;
      const mime = mr.mimeType || "audio/webm";
      const blob = new Blob(chunks.current, { type: mime });
      chunks.current = [];
      if (!blob.size) return;
      if (onClip && !before.current.trim()) onClip(blob, mime, Math.round(performance.now() - startedAt.current));
      else sendClip(blob, mime);
    };
    try { mr.stop(); } catch { setListening(false); }
  };

  /** Upload a clip: the server stores it and transcribes it. */
  const sendClip = (blob: Blob, mime: string) => {
    const fd = new FormData();
    const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm"; // Safari mp4, Firefox ogg
    fd.append("audio", blob, `note.${ext}`);
    fd.append("duration_ms", String(Math.round(performance.now() - startedAt.current)));
    const ctl = new AbortController();
    upload.current = ctl;
    setTranscribing(true);
    api("/voice/transcribe", { method: "POST", body: fd, signal: ctl.signal }).then(
      r => {
        if (ctl.signal.aborted) return;
        if (r?.recording_id) clipIds.current.push(r.recording_id);
        if (r?.transcript) {
          const t = r.transcript.trim();
          setText(before.current ? `${before.current} ${t}`.trim() : t);
          onNotice("Transcript ready. Review it and hit Save.");
        }
      },
      (e: { status?: number; body?: { recording_id?: string } }) => {
        if (ctl.signal.aborted) return;
        if (e?.body?.recording_id) { setRetryId(e.body.recording_id); onNotice("Couldn't transcribe. Your audio is saved."); }
        else if (e?.status === 413) onNotice("Recording too long. Keep it under 25 MB.");
        else if (e?.status === 415) onNotice("This browser's audio format isn't supported. Try Chrome.");
        else if (e?.status === 501) onNotice("Voice isn't set up on the server.");
        else onNotice("Transcribing failed. Check the connection and try again.");
      },
    ).finally(() => {
      if (upload.current === ctl) { upload.current = null; setTranscribing(false); }
    });
  };

  /** Record button: start listening with the best tier, or stop and keep what was said. */
  const toggle = async () => {
    if (transcribing) return;
    if (listening) { stopLive(); stopRecorder(true); return; }
    before.current = text;
    discarded.current = false;
    if (!tier.current) {
      try {
        const st = await api("/voice/status");
        tier.current = st?.wispr ? "wispr" : (st?.openai || st?.transcribe === "local") ? "whisper" : "browser";
      } catch { tier.current = "browser"; }
    }
    if (tier.current === "wispr") return startWispr();
    if (tier.current === "whisper") return startRecorder();
    return startBrowser();
  };

  /** Live streaming; any failure steps down to recording, then to the browser. */
  const startWispr = async () => {
    if (!wisprSupported()) { tier.current = "browser"; return startBrowser(); }
    let token: { access_token?: string; ws_url?: string };
    try { token = await api("/voice/token", { method: "POST", body: "{}" }); }
    catch { tier.current = "whisper"; return startRecorder(); }
    if (!token?.access_token) { tier.current = "whisper"; return startRecorder(); }
    const v = createWisprVoice({
      token: token.access_token, wsUrl: token.ws_url || "", base: text,
      onText: t => { if (!discarded.current) setText(t); },
      onError: code => {
        live.current = null; setListening(false); tier.current = "browser";
        onNotice(code === "not-allowed" ? "Microphone blocked. Allow mic access in site settings, then try again."
          : code === "audio-capture" ? "No microphone found. Check it's plugged in." : "Streaming voice hit an error. Try again.");
      },
      onEnd: () => { live.current = null; setListening(false); },
    });
    live.current = v;
    v.start();
    setListening(true);
  };

  /** Record the mic for upload. */
  const startRecorder = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { tier.current = "browser"; return startBrowser(); }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      setMicStream(stream);
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
      recorder.current = mr;
      mr.start();
      startedAt.current = performance.now();
      setListening(true);
    } catch {
      onNotice("Microphone blocked. Allow mic access in site settings, then try again.");
    }
  };

  /** The browser's own dictation, straight into the draft. */
  const startBrowser = () => {
    if (!browserSupported()) { onNotice("This browser has no speech recognition. Try Chrome, or type instead."); return; }
    if (!window.isSecureContext) { onNotice("Dictation needs localhost or HTTPS."); return; }
    const v = createVoice({
      base: text,
      onText: t => { if (!discarded.current) setText(t); },
      onError: code => {
        live.current = null; setListening(false);
        onNotice(code === "not-allowed" ? "Microphone blocked. Allow mic access in site settings, then try again."
          : code === "no-speech" ? "Didn't catch that. Try again." : code === "network" ? "Speech service unreachable. Typing still works."
          : `Microphone stopped (${code}). Check permissions and try again.`);
      },
      onEnd: () => { live.current = null; setListening(false); },
    });
    live.current = v;
    v.start();
    setListening(true);
  };

  /** Cancel: drop the recording (or the pending transcript) and put the draft back as it was. */
  const cancel = () => {
    discarded.current = true;
    upload.current?.abort();
    upload.current = null;
    setTranscribing(false);
    stopLive();
    stopRecorder(false);
    setListening(false);
    setText(before.current);
  };

  /** Try a stored clip again (the server reads the audio back). */
  const retry = async () => {
    if (!retryId || transcribing) return;
    setTranscribing(true);
    try {
      const r = await api(`/voice/recordings/${retryId}/retry`, { method: "POST", body: "{}" });
      const t = (r?.transcript || "").trim();
      if (t) setText(cur => (cur.trim() ? `${cur.trim()} ${t}` : t));
      if (!clipIds.current.includes(retryId)) clipIds.current.push(retryId);
      setRetryId(null);
      onNotice(t ? "Transcript ready. Review it and hit Save." : "Transcribed, but no speech was found in that clip.");
    } catch {
      onNotice("Still couldn't transcribe. Your audio is saved, try again in a bit.");
    } finally { setTranscribing(false); }
  };

  /** Before saving: stop listening. Returns false while a recording still has to be transcribed first. */
  const readyToSave = () => {
    if (transcribing) return false;
    if (recorder.current) { stopRecorder(true); return false; }
    if (listening) stopLive();
    return true;
  };

  /** The clips behind the draft, and forgetting them once the note is saved. */
  const clips = () => clipIds.current;
  const saved = () => { clipIds.current = []; setRetryId(null); };

  /** Stop everything (logout). */
  const stopAll = () => { stopLive(); stopRecorder(false); };

  return { listening, transcribing, micStream, retryId, toggle, cancel, retry, readyToSave, clips, saved, stopAll };
}
