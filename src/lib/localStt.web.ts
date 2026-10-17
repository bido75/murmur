// On-device transcription isn't offered in the browser.
import type { Utterance } from './types';

export const MODEL_MB = 57;
export const localSttSupported = () => false;
export const modelReady = () => false;
export const downloadModel = async () => {
  throw new Error('Not available on the web');
};
export const deleteModel = () => {};
export const LOCAL_RECORDING = {} as const;
export const transcribeLocal = async (_uri: string, _offsetMs: number, _language: string | null): Promise<Utterance[]> => {
  throw new Error('Not available on the web');
};
