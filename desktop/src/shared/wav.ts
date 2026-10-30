// Reading a WAV file.
//
// The desktop records WebM and the browser decodes it, but the local engine also
// needs to read WAV files: for the test fixtures, for imported audio, and because
// some machines hand over WAV directly.
//
// Pure, so it can be tested without a microphone.

export type WavAudio = {
  /** The samples, one channel, from -1 to 1. */
  samples: Float32Array;
  /** How many channels the file had. */
  channels: number;
  /** The rate the file was recorded at. */
  sampleRate: number;
  /** How long the audio is, in milliseconds. */
  durationMs: number;
};

/**
 * Read a 16-bit PCM WAV file.
 *
 * Only the parts that matter are handled: RIFF/WAVE, either `fmt ` chunk order, and
 * 16-bit PCM. Anything else is refused with a clear reason rather than producing
 * noise.
 */
export function readWav(bytes: Uint8Array): WavAudio {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) =>
    String.fromCharCode(
      bytes[at],
      bytes[at + 1],
      bytes[at + 2],
      bytes[at + 3],
    );

  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE")
    throw new Error("That is not a WAV file.");

  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataStart = -1;
  let dataLength = 0;

  // Walk the chunks.
  let at = 12;
  while (at + 8 <= bytes.length) {
    const name = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (name === "fmt " && size >= 16) {
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (name === "data") {
      dataStart = body;
      dataLength = Math.min(size, bytes.length - body);
    }
    // Chunks are padded to an even number of bytes.
    at = body + size + (size % 2);
  }

  if (dataStart < 0) throw new Error("That WAV file has no audio in it.");
  if (bitsPerSample !== 16)
    throw new Error(
      `That WAV file is ${bitsPerSample}-bit. Only 16-bit files can be read.`,
    );
  if (!channels) throw new Error("That WAV file does not say how many channels it has.");

  // The samples are interleaved; take the first channel.
  const frames = Math.floor(dataLength / (2 * channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    samples[i] = view.getInt16(dataStart + i * 2 * channels, true) / 32768;
  }

  return {
    samples,
    channels,
    sampleRate,
    durationMs: sampleRate ? Math.round((frames / sampleRate) * 1000) : 0,
  };
}
