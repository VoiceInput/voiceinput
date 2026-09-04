import { VoiceInputError } from "@voiceinput/provider";

import { TextHistory, type HistoryValue } from "./history.js";
import { TextTargetAdapter } from "./dom-target.js";
import {
  TextOwnershipModel,
  type MutableTextSpan,
  type TextMutation,
} from "./ownership-model.js";
import { TransformTimeoutError, runTransformWithTimeout } from "./transform.js";
import type {
  VoiceInputControlledTextBinding,
  CreateVoiceInputTextEngineOptions,
  VoiceInputTextEngineEvent,
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
  #transformTranscript: VoiceInputTransformTranscript | undefined;
  #transformTimeoutMs: number;
  readonly #model: TextOwnershipModel;
  readonly #target: TextTargetAdapter;

  #nextOptions:
    Omit<CreateVoiceInputTextEngineOptions, "controlled"> | undefined;
  updateOptions(
    options: Omit<CreateVoiceInputTextEngineOptions, "controlled">,
  ): void {
    if (
      options.interimBehavior !== undefined &&
      options.interimBehavior !== "inline" &&
      options.interimBehavior !== "expose"
    ) {
      throw invalidConfiguration("interimBehavior must be inline or expose.");
    }
    if (
      options.transformTimeoutMs !== undefined &&
      (!Number.isInteger(options.transformTimeoutMs) ||
        options.transformTimeoutMs <= 0)
    ) {
      throw invalidConfiguration(
        "transformTimeoutMs must be a positive finite integer.",
      );
    }
    if (
      options.transformTranscript !== undefined &&
      typeof options.transformTranscript !== "function"
    ) {
      throw invalidConfiguration("transformTranscript must be a function.");
    }
    this.#nextOptions = options;
  }
  #completionGeneration = 0;
  readonly #history = new TextHistory();
  readonly #listeners = new Set<(event: VoiceInputTextEngineEvent) => void>();
  readonly #suppressed = new Set<string>();
  readonly #closedSegments = new Set<string>();
  #implicitSegment = 0;
  #currentSegment: string | undefined;
  #limitedSegment: string | undefined;
  #composing = false;
  #beforeInput: HistoryValue | undefined;
  #inputType = "insertText";

  subscribe(listener: (event: VoiceInputTextEngineEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  isWritable(): boolean {
    return this.#target.isWritable();
  }

  undo(): void {
    this.#restoreHistory(false);
  }
  redo(): void {
    this.#restoreHistory(true);
  }

  #restoreHistory(redo: boolean): void {
    if (!this.isWritable() || this.#composing) return;
    const state = redo ? this.#history.redo() : this.#history.undo();
    if (!state) return;
    this.#takeOwnership();
    this.#invalidateCompletion();
    this.#model.replaceTarget(state.value);
    if (state.selection) this.#model.captureSelection(state.selection);
    this.#target.applyMutation({ ...state, changed: true });
  }

  #takeOwnership(): void {
    if (this.#currentSegment !== undefined)
      this.#suppressed.add(this.#currentSegment);
    this.#model.beforeInput();
    this.#history.breakGroup();
  }

  #emit(event: VoiceInputTextEngineEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        reportUnhandledError(error);
      }
    }
  }

  #state(): HistoryValue {
    return {
      value: this.#model.value,
      selection: this.#target.readSelection() ?? this.#model.selection,
    };
  }

  #availabilityChanged(): void {
    if (!this.isWritable()) {
      this.#takeOwnership();
      this.#invalidateCompletion();
      this.#emit({ type: "target-unavailable" });
    }
  }

  #reset(): void {
    this.#beforeInput = undefined;
    this.#takeOwnership();
    this.#invalidateCompletion();
    this.#model.replaceTarget(this.#target.readValue());
    this.#model.cancel();
    this.#history.clear();
    this.#emit({ type: "reset" });
  }

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
      onBeforeInput: (inputType) => {
        this.#beforeInput = this.#state();
        this.#inputType = inputType;
        if (!this.#composing) {
          if (this.#currentSegment !== undefined)
            this.#suppressed.add(this.#currentSegment);
          this.#model.beforeInput();
        }
      },
      onHistory: (redo) => this.#restoreHistory(redo),
      onComposition: (active) => {
        if (active) this.#takeOwnership();
        this.#composing = active;
        if (!active) {
          this.#handleInput();
          this.#history.breakGroup();
        }
      },
      onReset: () => this.#reset(),
      onAvailability: () => this.#availabilityChanged(),
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

    const wasAttached = this.#target.target !== null;
    this.#takeOwnership();
    this.#history.clear();
    this.#beforeInput = undefined;
    this.#composing = false;
    this.#invalidateCompletion();
    this.#model.cancel();
    if (wasAttached) this.#emit({ type: "reset" });
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
    if (!sameSelection(this.#model.selection, selection)) this.#takeOwnership();
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

    if (this.#composing) return;
    if (value !== this.#model.value) this.#history.clear();
    const committedSelection = this.#target.readSelectionWhenValueIs(value);
    this.#model.reconcileExternalValue(value, committedSelection);
    if (
      this.#currentSegment !== undefined &&
      !this.#model
        .getSnapshot()
        .spans.some((span) => span.state === "provisional")
    )
      this.#suppressed.add(this.#currentSegment);
    this.#target.synchronize(this.#model.value, this.#model.selection);
  }

  begin(): void {
    if (this.#nextOptions) {
      this.#model.setInterimBehavior(
        this.#nextOptions.interimBehavior ?? "inline",
      );
      this.#transformTranscript = this.#nextOptions.transformTranscript;
      this.#transformTimeoutMs = this.#nextOptions.transformTimeoutMs ?? 10_000;
    }
    this.#invalidateCompletion();
    this.#model.begin();
    this.#suppressed.clear();
    this.#closedSegments.clear();
    this.#implicitSegment = 0;
    this.#currentSegment = undefined;
    this.#limitedSegment = undefined;
    this.#history.breakGroup();
    if (!this.#model.hasSelection) {
      this.captureSelection();
    }
  }

  applyInterim(text: string, segmentId?: string): void {
    this.#applyTranscript(text, segmentId, false);
  }

  applyFinal(text: string, segmentId?: string): void {
    this.#applyTranscript(text, segmentId, true);
  }

  #applyTranscript(
    text: string,
    segmentId: string | undefined,
    final: boolean,
  ): void {
    if (typeof text !== "string" || !this.#model.isRunActive) return;
    const id = segmentId ?? `implicit:${this.#implicitSegment}`;
    if (this.#closedSegments.has(id)) return;
    this.#reconcileUncontrolledDomValue();
    if (this.#currentSegment !== undefined && this.#currentSegment !== id) {
      this.#takeOwnership();
    }
    if (this.#currentSegment !== id) this.#history.breakGroup();
    this.#currentSegment = id;
    if (
      this.#composing ||
      !this.isWritable() ||
      (this.#limitedSegment !== undefined && this.#limitedSegment !== id)
    ) {
      this.#suppressed.add(id);
      this.#model.beforeInput();
    }
    if (!this.#suppressed.has(id)) {
      const before = this.#state();
      this.#model.configureMutation(
        this.#target.target?.maxLength ?? -1,
        final ? "final" : "interim",
      );
      const mutation = final
        ? this.#model.applyFinal(text, true)
        : this.#model.applyInterim(text, true);
      this.#applyMutation(mutation, before, `voice:${id}`);
      const limit = this.#model.takeLimit();
      if (limit) {
        const firstLimit = this.#limitedSegment === undefined;
        this.#limitedSegment = id;
        if (firstLimit) this.#emit(limit);
      }
    }
    if (final) {
      this.#closedSegments.add(id);
      this.#currentSegment = undefined;
      this.#implicitSegment += 1;
      this.#history.breakGroup();
    }
  }

  complete(): VoiceInputTextCompletion {
    if (!this.#model.isRunActive) {
      return { processing: false, result: Promise.resolve([]) };
    }

    const before = this.#state();
    this.#model.configureMutation(
      this.#target.target?.maxLength ?? -1,
      "final",
    );
    const completion = this.#model.complete(
      this.#target.isWritable() && !this.#composing,
    );
    this.#applyMutation(
      completion.mutation,
      before,
      `voice:${this.#currentSegment}`,
    );
    const limit = this.#model.takeLimit();
    if (limit) this.#emit(limit);
    this.#history.breakGroup();
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
    const before = this.#state();
    if (!this.isWritable() || this.#composing) this.#takeOwnership();
    this.#applyMutation(
      this.#model.cancel(),
      before,
      `voice:${this.#currentSegment}`,
    );
    this.#currentSegment = undefined;
    this.#history.breakGroup();
  }

  destroy(): void {
    this.#invalidateCompletion();
    this.#model.destroy();
    this.#target.detach();
    this.#history.clear();
    this.#listeners.clear();
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
        !this.isWritable() ||
        this.#composing ||
        completionGeneration !== this.#completionGeneration ||
        !this.#model.canApplyTransform(span, generation, originalText)
      ) {
        return null;
      }

      const before = this.#state();
      this.#model.configureMutation(
        this.#target.target?.maxLength ?? -1,
        "transform",
      );
      this.#history.breakGroup();
      this.#applyMutation(
        this.#model.applyTransform(span, transformed),
        before,
        `transform:${span.id}`,
      );
      const limit = this.#model.takeLimit();
      if (limit) this.#emit(limit);
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
    const before = this.#beforeInput ?? {
      value: this.#model.value,
      selection: this.#model.selection,
    };
    this.#beforeInput = undefined;
    this.#model.reconcileExternalValue(this.#target.readValue(), selection);
    const key = this.#composing ? "composition" : this.#inputType;
    if (
      ![
        "insertText",
        "deleteContentBackward",
        "deleteContentForward",
        "composition",
      ].includes(key)
    )
      this.#history.breakGroup();
    this.#history.record(before, this.#state(), key);
  }

  #handleSelectionChange(): void {
    const selection = this.#target.readSelection();
    if (selection !== null && !this.#composing) {
      if (!sameSelection(selection, this.#model.selection))
        this.#takeOwnership();
      this.#model.selectionChanged(selection);
    }
  }

  #reconcileUncontrolledDomValue(): void {
    if (this.#target.isControlled || this.#target.target === null) {
      return;
    }
    const value = this.#target.readValue();
    if (value !== this.#model.value) {
      this.#takeOwnership();
      this.#history.clear();
      this.#model.reconcileExternalValue(value, this.#target.readSelection());
    }
  }

  #applyMutation(
    mutation: TextMutation | null,
    before?: HistoryValue,
    key = "voice",
  ): void {
    if (mutation !== null) {
      if (before && mutation.changed)
        this.#history.record(before, mutation, key);
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

function sameSelection(
  left: VoiceInputTextSelection | null,
  right: VoiceInputTextSelection | null,
): boolean {
  return (
    left?.start === right?.start &&
    left?.end === right?.end &&
    (left?.start === left?.end || left?.direction === right?.direction)
  );
}
