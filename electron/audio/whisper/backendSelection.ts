export type LocalSttBackend = 'whispercpp' | 'medium';

export interface BackendSelectionInput {
  preferredBackend?: LocalSttBackend;
  hasNvidiaCuda: boolean;
  whisperCppReady: boolean;
}

export function resolveLocalWhisperBackend(input: BackendSelectionInput): LocalSttBackend {
  if (input.preferredBackend === 'medium') return 'medium';
  if (!input.hasNvidiaCuda) return 'medium';
  if (!input.whisperCppReady) return 'medium';
  return 'whispercpp';
}
