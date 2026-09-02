import {
  createBrowserAudioSource,
  type VoiceAudioSource,
} from "@voiceinput/core";
import type { VoiceInputProviderV1 } from "@voiceinput/provider";
import { createContext, useMemo, type ReactNode } from "react";

import { VoiceInputCoordinator } from "./coordinator.js";

export interface VoiceInputProviderProps {
  readonly provider: VoiceInputProviderV1;
  readonly audioSource?: VoiceAudioSource;
  readonly children?: ReactNode;
}

export interface VoiceInputContextValue {
  readonly provider: VoiceInputProviderV1;
  readonly audioSource: VoiceAudioSource;
  readonly coordinator: VoiceInputCoordinator;
}

export const VoiceInputContext = createContext<VoiceInputContextValue | null>(
  null,
);

export function VoiceInputProvider({
  provider,
  audioSource,
  children,
}: VoiceInputProviderProps): ReactNode {
  const browserAudioSource = useMemo(() => createBrowserAudioSource(), []);
  const resolvedAudioSource = audioSource ?? browserAudioSource;
  const coordinator = useMemo(() => new VoiceInputCoordinator(), []);
  const value = useMemo<VoiceInputContextValue>(
    () => ({
      provider,
      audioSource: resolvedAudioSource,
      coordinator,
    }),
    [coordinator, provider, resolvedAudioSource],
  );

  return (
    <VoiceInputContext.Provider value={value}>
      {children}
    </VoiceInputContext.Provider>
  );
}
