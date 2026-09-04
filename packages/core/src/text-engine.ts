import { VoiceInputError } from "@voiceinput/provider";

import { VoiceInputTextEngineController } from "./text-engine/controller.js";
import type {
  CreateVoiceInputTextEngineOptions,
  VoiceInputTextEngine,
} from "./text-engine/types.js";

const DEFAULT_TRANSFORM_TIMEOUT_MS = 10_000;

export type {
  CreateVoiceInputTextEngineOptions,
  VoiceInputControlledTextBinding,
  VoiceInputInterimBehavior,
  VoiceInputTextCompletion,
  VoiceInputTextLimit,
  VoiceInputTextEngineEvent,
  VoiceInputTextEngine,
  VoiceInputTextEngineSnapshot,
  VoiceInputTextSelection,
  VoiceInputTextSpan,
  VoiceInputTextSpanState,
  VoiceInputTextTarget,
  VoiceInputTransformTranscript,
} from "./text-engine/types.js";

export function createVoiceInputTextEngine(
  options: CreateVoiceInputTextEngineOptions = {},
): VoiceInputTextEngine {
  const interimBehavior = options.interimBehavior ?? "inline";
  if (interimBehavior !== "inline" && interimBehavior !== "expose") {
    throw invalidConfiguration(
      'interimBehavior must be either "inline" or "expose".',
    );
  }
  if (
    options.transformTimeoutMs !== undefined &&
    (!Number.isFinite(options.transformTimeoutMs) ||
      !Number.isInteger(options.transformTimeoutMs) ||
      options.transformTimeoutMs <= 0)
  ) {
    throw invalidConfiguration(
      "transformTimeoutMs must be a positive finite integer.",
    );
  }
  if (
    options.controlled !== undefined &&
    (typeof options.controlled.getValue !== "function" ||
      typeof options.controlled.onValueChange !== "function")
  ) {
    throw invalidConfiguration(
      "controlled must provide getValue and onValueChange functions.",
    );
  }
  if (
    options.transformTranscript !== undefined &&
    typeof options.transformTranscript !== "function"
  ) {
    throw invalidConfiguration("transformTranscript must be a function.");
  }

  return new VoiceInputTextEngineController({
    interimBehavior,
    controlled: options.controlled,
    transformTranscript: options.transformTranscript,
    transformTimeoutMs:
      options.transformTimeoutMs ?? DEFAULT_TRANSFORM_TIMEOUT_MS,
  });
}

function invalidConfiguration(message: string): VoiceInputError {
  return new VoiceInputError({ code: "invalid-configuration", message });
}
