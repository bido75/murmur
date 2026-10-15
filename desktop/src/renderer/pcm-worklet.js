// Plays raw Float32 PCM chunks (posted from the page) into the Web Audio graph,
// so macOS system audio can be mixed with the mic and recorded like any other source.
class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = sampleRate * 4; // up to 4 s buffered
    this.buf = new Float32Array(this.capacity);
    this.read = 0;
    this.write = 0;
    this.size = 0;
    this.port.onmessage = (e) => {
      const data = e.data;
      for (let i = 0; i < data.length; i++) {
        this.buf[this.write] = data[i];
        this.write = (this.write + 1) % this.capacity;
        if (this.size < this.capacity) this.size++;
        else this.read = (this.read + 1) % this.capacity; // drop oldest if we fall behind
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    for (let i = 0; i < out.length; i++) {
      if (this.size > 0) {
        out[i] = this.buf[this.read];
        this.read = (this.read + 1) % this.capacity;
        this.size--;
      } else out[i] = 0;
    }
    return true;
  }
}
registerProcessor('pcm-player', PcmPlayer);
