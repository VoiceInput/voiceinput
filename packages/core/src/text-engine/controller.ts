import { VoiceInputError } from "@voiceinput/provider";

import { TextTargetAdapter } from "./dom-target.js";
import {
  TextOwnershipModel,
  type MutableTextSpan,
  type TextMutation,
} from "./ownership-model.js";
import { TransformTimeoutError, runTransformWithTimeout } from "./transform.js";
import type {
  VoiceInputControlledTextBinding,
  VoiceInputInterimBehavior,
  VoiceInputTextCompletion,
  VoiceInputTextEngine,
  VoiceInputTextEngineSnapshot,
  VoiceInputTextSelection,
  VoiceInputTextTarget,
  VoiceInputTransformTranscript,
} from "./types.js";

export class VoiceInputTextEngineController implements VoiceInputTextEngine {
  readonly #controlled: VoiceInputControlledTextBinding | undefined;
  readonly #transformTranscript: VoiceInputTransformTranscript | undefined;
  readonly #transformTimeoutMs: number;
  readonly #model: TextOwnershipModel;
  readonly #target: TextTargetAdapter;

  #completionGeneration = 0;

  constructor(options: {
    interimBehavior: VoiceInputInterimBehavior;
    controlled: VoiceInputControlledTextBinding | undefined;
    transformTranscript: VoiceInputTransformTranscript | undefined;
    transformTimeoutMs: number;
  }) {
    this.#controlled = options.controlled;
    this.#transformTranscript = options.transformTranscript;
    this.#transformTimeoutMs = options.transformTimeoutMs;
    this.#model = new TextOwnershipModel(options.interimBehavior);
    this.#target = new TextTargetAdapter(options.controlled, {
      onBeforeInput: () => this.#model.beforeInput(),
      onInput: () => this.#handleInput(),
      onSelectionChange: () => this.#handleSelectionChange(),
      onUnhandledError: reportUnhandledError,
    });
  }

  getSnapshot(): VoiceInputTextEngineSnapshot {
    return this.#model.getSnapshot();
  }

  setTarget(target: VoiceInputTextTarget | null): void {
    if (target === this.#target.target) {
      return;
    }

    this.#invalidateCompletion();
    if (target === null) {
      this.#target.detach();
      this.#model.replaceTarget("");
      return;
    }

    const value = this.#target.attach(target);
    this.#model.replaceTarget(value);
    this.#target.synchronize(this.#model.value, this.#model.selection);
  }

  captureSelection(): VoiceInputTextSelection | null {
    if (!this.#target.isWritable()) {
      return null;
    }

    this.#reconcileUncontrolledDomValue();
    const selection = this.#target.readSelection();
    if (selection === null) {
      return null;
    }
    this.#model.captureSelection(selection);
    return Object.freeze({ ...selection });
  }

  reconcileControlledValue(value: string): void {
    if (this.#controlled === undefined) {
      throw invalidConfiguration(
        "reconcileControlledValue is only available for controlled text engines.",
      );
    }
    if (typeof value !== "string") {
      throw invalidConfiguration("A controlled value must be a string.");
    }

    const committedSelection = this.#target.readSelectionWhenValueIs(value);
    this.#model.reconcileExternalValue(value, committedSelection);
    this.#target.synchronize(this.#model.value, this.#model.selection);
  }

  begin(): void {
    this.#invalidateCompletion();
    this.#model.begin();
    if (!this.#model.hasSelection) {
      this.captureSelection();
    }
  }

  applyInterim(text: string): void {
    if (typeof text !== "string" || !this.#model.isRunActive) {
      return;
    }
    this.#reconcileUncontrolledDomValue();
    this.#applyMutation(
      this.#model.applyInterim(text, this.#target.isWritable()),
    );
  }

  applyFinal(text: string): void {
    if (typeof text !== "string" || !this.#model.isRunActive) {
      return;
    }
    this.#reconcileUncontrolledDomValue();
    this.#applyMutation(
      this.#model.applyFinal(text, this.#target.isWritable()),
    );
  }

  complete(): VoiceInputTextCompletion {
    if (!this.#model.isRunActive) {
      return { processing: false, result: Promise.resolve([]) };
    }

    const completion = this.#model.complete(this.#target.isWritable());
    this.#applyMutation(completion.mutation);
    const processing =
      this.#transformTranscript !== undefined && completion.spans.length > 0;
    const completionGeneration = ++this.#completionGeneration;

    if (!processing || this.#transformTranscript === undefined) {
      return { processing: false, result: Promise.resolve([]) };
    }

    return {
      processing: true,
      result: Promise.all(
        completion.spans.map((span) =>
          this.#transformSpan(span, completionGeneration),
        ),
      ).then((errors) => errors.filter(isVoiceInputError)),
    };
  }

  cancel(): void {
    this.#invalidateCompletion();
    this.#applyMutation(this.#model.cancel());
  }

  destroy(): void {
    this.#invalidateCompletion();
    this.#model.destroy();
    this.#target.detach();
  }

  async #transformSpan(
    span: MutableTextSpan,
    completionGeneration: number,
  ): Promise<VoiceInputError | null> {
    const transform = this.#transformTranscript;
    if (transform === undefined || !this.#model.proveSpan(span)) {
      return null;
    }

    const generation = span.generation;
    const originalText = this.#model.getSpanText(span);
    const transcript = originalText.trim();

    try {
      const transformed = await runTransformWithTimeout(
        () => transform(transcript),
        this.#transformTimeoutMs,
      );
      if (typeof transformed !== "string") {
        throw new TypeError("transformTranscript must resolve to a string.");
      }
      if (
        completionGeneration !== this.#completionGeneration ||
        !this.#model.canApplyTransform(span, generation, originalText)
      ) {
        return null;
      }

      this.#applyMutation(this.#model.applyTransform(span, transformed));
      return null;
    } catch (cause) {
      if (completionGeneration !== this.#completionGeneration) {
        return null;
      }
      this.#model.freezeFailedTransform(span);
      return new VoiceInputError({
        code: "transform-error",
        message:
          cause instanceof TransformTimeoutError
            ? `Transcript transform timed out after ${this.#transformTimeoutMs}ms.`
            : "Transcript transform failed.",
        cause,
      });
    }
  }

  #handleInput(): void {
    const selection = this.#target.readSelection();
    this.#model.reconcileExternalValue(this.#target.readValue(), selection);
  }

  #handleSelectionChange(): void {
    const selection = this.#target.readSelection();
    if (selection !== null) {
      this.#model.selectionChanged(selection);
    }
  }

  #reconcileUncontrolledDomValue(): void {
    if (this.#target.isControlled || this.#target.target === null) {
      return;
    }
    const value = this.#target.readValue();
    if (value !== this.#model.value) {
      this.#model.reconcileExternalValue(value, this.#target.readSelection());
    }
  }

  #applyMutation(mutation: TextMutation | null): void {
    if (mutation !== null) {
      this.#target.applyMutation(mutation);
    }
  }

  #invalidateCompletion(): void {
    this.#completionGeneration += 1;
  }
}

function invalidConfiguration(message: string): VoiceInputError {
  return new VoiceInputError({ code: "invalid-configuration", message });
}

function isVoiceInputError(
  error: VoiceInputError | null,
): error is VoiceInputError {
  return error !== null;
}

function reportUnhandledError(error: unknown): void {
  const reportError = (
    globalThis as typeof globalThis & {
      reportError?: (error: unknown) => void;
    }
  ).reportError;
  if (typeof reportError === "function") {
    reportError(error);
  } else {
    queueMicrotask(() => {
      throw error;
    });
  }
}
