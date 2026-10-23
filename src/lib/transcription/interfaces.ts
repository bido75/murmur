import { Utterance } from "@/lib/types";

export type ProviderCapability = "cloud" | "local" | "auto";
export type ProviderType = "deepgram" | "whisper" | "parakeet";
export type TranscriptionLanguage = string | null;

export interface TranscriptionOptions {
  language?: TranscriptionLanguage;
  redact?: string[];
  multichannel?: boolean;
  keyterms?: string[];
  onProgress?: (progress: number) => void;
  privacy?: "local-only" | "cloud-allowed";
}

export interface TranscriptionResult {
  utterances: Utterance[];
  durationMs: number;
  language: TranscriptionLanguage;
  provider: ProviderType;
  confidence?: number;
  speakerNames?: Record<string, string>;
}

export interface TranscriptionProvider {
  readonly type: ProviderType;
  readonly capabilities: ProviderCapability[];
  
  canTranscribe(options?: TranscriptionOptions): Promise<boolean>;
  
  transcribe(
    source: string,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResult>;
  
  isAvailable(): Promise<boolean>;
  
  getSupportedLanguages?(): Promise<TranscriptionLanguage[]>;
  
  getEstimatedDurationMs?(source: string): Promise<number>;
}

export interface TranscriptionEngine {
  setDefaultProvider(type: ProviderType): void;
  
  selectProvider(
    preferredTypes: ProviderType[],
    context?: Partial<TranscriptionOptions>
  ): ProviderType;
  
  transcribe(
    source: string,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResult>;
  
  isAvailable(type: ProviderType): Promise<boolean>;
}

export interface ProviderStatus {
  type: ProviderType;
  available: boolean;
  requiresSetup: boolean;
  error?: string;
  metadata?: {
    model?: string;
    language?: string;
    estimatedDuration?: number;
    supportsMultichannel?: boolean;
  };
}

export interface PrivacySettings {
  localOnlyMode: boolean;
  allowedProviders: ProviderType[];
  autoSelectBasedOnNetwork: boolean;
  warnBeforeCloudUpload: boolean;
}
