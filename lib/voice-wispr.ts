// Wispr Flow WebSocket engine — same VoiceEngine shape as lib/voice.ts.
// Needs a short-lived client token from POST /voice/token (org key stays backend).

export type WisprOpts = {
  token: string;
  wsUrl: string;
  base: string;
  onText: (v: string) => void;
  onError: (msg: string) => void;
  onEnd: () => void;
};

// Encode raw PCM bytes to base64 for the Wispr append protocol.
function b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// True when mic + AudioContext exist for Wispr live streaming.
export function supported(): boolean {
  return typeof window !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof AudioContext !== "undefined";
}

// Stream mic audio to Wispr over WS (auth → append → commit); same shape as lib/voice.ts.
export function createWisprVoice(opts: WisprOpts): { start: () => void; stop: () => void } {
  let ws: WebSocket | null = null;
  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let node: AudioWorkletNode | null = null;
  let position = 0;
  let settled = "";
  let stopped = false;

  // Tear down mic, AudioContext, and socket after stop/error.
  const cleanup = () => {
    try { node?.disconnect(); } catch { /* noop */ }
    try { ctx?.close(); } catch { /* noop */ }
    try { stream?.getTracks().forEach(t => t.stop()); } catch { /* noop */ }
    try { if (ws && ws.readyState === WebSocket.OPEN) ws.close(); } catch { /* noop */ }
    ws = null; ctx = null; stream = null; node = null;
  };

  // Merge settled + interim speech into the draft (prefixed with prior text).
  const emit = (spoken: string) => {
    const t = (settled + " " + spoken).trim();
    opts.onText(opts.base ? `${opts.base} ${t}`.trim() : t);
  };

  // Open mic + WS, auth with the short-lived token, pipe 16kHz chunks to Wispr.
  const start = async () => {
    stopped = false;
    position = 0;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      opts.onError("not-allowed");
      return;
    }
    ws = new WebSocket(opts.wsUrl);
    ws.onopen = () => {
      ws?.send(JSON.stringify({
        type: "auth", access_token: opts.token,
        context: { app: { name: "bigbutter notes", type: "ai" }, user_identifier: "note-taker" },
        language: ["en"],
      }));
    };
    ws.onmessage = ev => {
      let m: { status?: string; error?: string; body?: { text?: string; is_final?: boolean } };
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.error) { opts.onError("provider:" + m.error); return; }
      if (m.status === "text" && m.body?.text) {
        if (m.body.is_final) { settled = (settled + " " + m.body.text).trim(); emit(""); }
        else emit(m.body.text);
      }
    };
    ws.onerror = () => opts.onError("network");
    ws.onclose = () => { if (!stopped) opts.onEnd(); };
    try {
      ctx = new AudioContext({ sampleRate: 16000 });
      const src = ctx.createMediaStreamSource(stream);
      await ctx.audioWorklet.addModule("/wispr-worklet.js");
      node = new AudioWorkletNode(ctx, "wispr-capture");
      node.port.onmessage = (e: MessageEvent) => {
        if (e.data?.type !== "audio" || !ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({
          type: "append", position: position++,
          audio_packets: {
            packets: [b64(e.data.pcm)], volumes: [e.data.volume],
            packet_duration: 0.05, audio_encoding: "wav", byte_encoding: "base64",
          },
        }));
      };
      src.connect(node);
    } catch {
      cleanup();
      opts.onError("audio-capture");
    }
  };

  // Commit the stream (final transcript) then clean up and signal the end.
  const stop = () => {
    stopped = true;
    try {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "commit", total_packets: position }));
    } catch { /* noop */ }
    setTimeout(() => { cleanup(); opts.onEnd(); }, 800);
  };

  return { start: () => { void start(); }, stop };
}
