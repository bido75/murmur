// Not used in the browser.
export const pcmRecorderAvailable = () => false;
export const repairWav = (_uri: string) => 0;
export class PcmWavRecorder {
  level = -160;
  durationMs = 0;
  start(_uri: string) {
    throw new Error('Not available on the web');
  }
  pause() {}
  resume() {}
  finishFile() {
    return 0;
  }
  async release() {}
}
