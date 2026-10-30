// AudioWorklet for Wispr Flow streaming: 16kHz Int16 chunks. Ported from Wispr docs.
class WisprCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.target = 800; // ~50ms at 16kHz
  }
  // Slice mic input into ~50ms Int16 chunks and post them (with volume) to the page.
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) this.buffer.push(ch[i]);
    while (this.buffer.length >= this.target) {
      const chunk = this.buffer.slice(0, this.target);
      this.buffer = this.buffer.slice(this.target);
      const pcm = new Int16Array(chunk.length);
      let sum = 0;
      for (let i = 0; i < chunk.length; i++) {
        const s = Math.max(-1, Math.min(1, chunk[i]));
        pcm[i] = s < 0 ? Math.floor(s * 32768) : Math.floor(s * 32767);
        sum += chunk[i] * chunk[i];
      }
      this.port.postMessage({
        type: "audio",
        pcm: pcm.buffer,
        volume: Math.sqrt(sum / chunk.length),
      }, [pcm.buffer]);
    }
    return true;
  }
}
registerProcessor("wispr-capture", WisprCapture);
