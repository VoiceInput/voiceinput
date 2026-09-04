import type {
  VoiceInputInterimBehavior,
  VoiceInputTextLimit,
  VoiceInputTextEngineSnapshot,
  VoiceInputTextSelection,
  VoiceInputTextSpanState,
} from "./types.js";
import { normalizeTranscriptInsertion } from "../transcript-boundary.js";

export interface MutableTextSpan {
  id: number;
  start: number;
  end: number;
  state: VoiceInputTextSpanState;
  runId: number;
  generation: number;
  expectedText: string;
  replacedText?: string;
}

interface MutableTextSelection {
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
  replacePending: boolean;
}

export interface TextEdit {
  oldStart: number;
  oldEnd: number;
  newEnd: number;
}

export interface TextMutation {
  readonly changed: boolean;
  readonly selection: VoiceInputTextSelection | null;
  readonly value: string;
}

export interface TextCompletionState {
  readonly mutation: TextMutation | null;
  readonly runId: number;
  readonly spans: readonly MutableTextSpan[];
}

export class TextOwnershipModel {
  #interimBehavior: VoiceInputInterimBehavior;

  #maxLength = -1;
  #source: VoiceInputTextLimit["source"] = "final";
  #limit: VoiceInputTextLimit | undefined;
  #value = "";
  #selection: MutableTextSelection | null = null;
  #spans: MutableTextSpan[] = [];
  #provisional: MutableTextSpan | undefined;
  #currentFinalSpan: MutableTextSpan | undefined;
  #interimTranscript = "";
  #runId = 0;
  #runActive = false;
  #nextSpanId = 1;
  #nextGeneration = 1;

  constructor(interimBehavior: VoiceInputInterimBehavior) {
    this.#interimBehavior = interimBehavior;
  }

  configureMutation(
    maxLength: number,
    source: VoiceInputTextLimit["source"],
  ): void {
    this.#maxLength = maxLength;
    this.#source = source;
    this.#limit = undefined;
  }

  takeLimit(): VoiceInputTextLimit | undefined {
    const limit = this.#limit;
    this.#limit = undefined;
    return limit;
  }

  #limitReplacement(start: number, end: number, text: string): string {
    if (this.#maxLength < 0) return text;
    const available = Math.max(
      0,
      this.#maxLength - (this.#value.length - (end - start)),
    );
    if (text.length < available || text.length === 0) return text;
    let insertedText = "";
    for (const { segment } of new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    }).segment(text)) {
      if (insertedText.length + segment.length > available) break;
      insertedText += segment;
    }
    this.#limit = {
      type: "text-limit",
      maxLength: this.#maxLength,
      text,
      insertedText,
      source: this.#source,
    };
    return insertedText;
  }

  setInterimBehavior(behavior: VoiceInputInterimBehavior): void {
    this.#interimBehavior = behavior;
  }

  get value(): string {
    return this.#value;
  }

  get selection(): VoiceInputTextSelection | null {
    return this.#selection === null
      ? null
      : {
          start: this.#selection.start,
          end: this.#selection.end,
          direction: this.#selection.direction,
        };
  }

  get hasSelection(): boolean {
    return this.#selection !== null;
  }

  get isRunActive(): boolean {
    return this.#runActive;
  }

  getSnapshot(): VoiceInputTextEngineSnapshot {
    const selection =
      this.#selection === null
        ? null
        : Object.freeze({
            start: this.#selection.start,
            end: this.#selection.end,
            direction: this.#selection.direction,
          });
    const spans = this.#spans.map((span) =>
      Object.freeze({
        id: span.id,
        start: span.start,
        end: span.end,
        text: this.#value.slice(span.start, span.end),
        state: span.state,
      }),
    );

    return Object.freeze({
      value: this.#value,
      selection,
      interimTranscript: this.#interimTranscript,
      spans: Object.freeze(spans),
    });
  }

  replaceTarget(value: string): void {
    this.freezeForTargetReplacement();
    this.#value = value;
    this.#selection = null;
    this.#spans = [];
    this.#provisional = undefined;
    this.#currentFinalSpan = undefined;
  }

  captureSelection(selection: VoiceInputTextSelection): void {
    this.#freezeProvisional();
    this.#currentFinalSpan = undefined;
    this.#selection = toMutableSelection(selection);
  }

  begin(): void {
    this.#runId += 1;
    this.#runActive = true;
    this.#interimTranscript = "";
    this.#provisional = undefined;
    this.#currentFinalSpan = undefined;
  }

  applyInterim(text: string, canInsert: boolean): TextMutation | null {
    if (!this.#runActive || !canInsert) {
      return null;
    }

    this.#interimTranscript = text;
    if (this.#interimBehavior === "expose") {
      return null;
    }

    if (this.#provisional !== undefined) {
      if (this.proveSpan(this.#provisional)) {
        return this.#replaceOwnedSpan(this.#provisional, text, "provisional")
          .mutation;
      }
      this.#abandonProvisional();
    }

    if (text.length === 0 || !canInsert) {
      return null;
    }

    const inserted = this.#insertAtAnchor(text, "provisional");
    this.#provisional = inserted?.span;
    return inserted?.mutation ?? null;
  }

  applyFinal(text: string, canInsert: boolean): TextMutation | null {
    if (!this.#runActive || !canInsert) {
      return null;
    }

    this.#interimTranscript = "";
    let finalized: MutableTextSpan | undefined;
    let mutation: TextMutation | null = null;

    if (this.#provisional !== undefined) {
      if (this.proveSpan(this.#provisional)) {
        const replaced = this.#replaceOwnedSpan(
          this.#provisional,
          text,
          "finalized",
        );
        finalized = replaced?.span;
        mutation = replaced?.mutation ?? null;
      } else {
        this.#abandonProvisional();
      }
      this.#provisional = undefined;
    }

    if (finalized === undefined && text.length > 0 && canInsert) {
      const inserted = this.#insertAtAnchor(text, "finalized");
      finalized = inserted?.span;
      mutation = inserted?.mutation ?? mutation;
    }

    if (finalized !== undefined) {
      this.#mergeFinalizedSpan(finalized);
    }
    return mutation;
  }

  complete(canInsert: boolean): TextCompletionState {
    let mutation: TextMutation | null = null;

    if (this.#runActive && this.#provisional !== undefined) {
      if (this.proveSpan(this.#provisional)) {
        this.#provisional.state = "finalized";
        delete this.#provisional.replacedText;
        this.#mergeFinalizedSpan(this.#provisional);
      } else {
        this.#abandonProvisional();
      }
      this.#provisional = undefined;
    } else if (
      this.#runActive &&
      this.#interimBehavior === "expose" &&
      this.#interimTranscript.length > 0 &&
      canInsert
    ) {
      const inserted = this.#insertAtAnchor(
        this.#interimTranscript,
        "finalized",
      );
      if (inserted !== undefined) {
        this.#mergeFinalizedSpan(inserted.span);
        mutation = inserted.mutation;
      }
    }

    this.#interimTranscript = "";
    const runId = this.#runId;
    const spans = this.#spans.filter(
      (span) => span.runId === runId && span.state === "finalized",
    );
    this.#runActive = false;
    this.#currentFinalSpan = undefined;
    return { mutation, runId, spans };
  }

  cancel(): TextMutation | null {
    let mutation: TextMutation | null = null;
    if (this.#provisional !== undefined) {
      if (this.proveSpan(this.#provisional)) {
        mutation = this.#removeOwnedSpan(this.#provisional);
      } else {
        this.#abandonProvisional();
      }
    }
    this.#provisional = undefined;
    this.#interimTranscript = "";
    this.#currentFinalSpan = undefined;
    this.#runActive = false;
    return mutation;
  }

  freezeForTargetReplacement(): void {
    this.#freezeProvisional();
    for (const span of this.#spans) {
      if (span.state === "finalized") {
        span.state = "frozen";
        span.generation = this.#nextGeneration++;
      }
    }
    this.#currentFinalSpan = undefined;
  }

  destroy(): void {
    this.freezeForTargetReplacement();
    this.#selection = null;
    this.#interimTranscript = "";
    this.#runActive = false;
  }

  beforeInput(): void {
    this.#freezeProvisional();
    this.#currentFinalSpan = undefined;
  }

  reconcileExternalValue(
    value: string,
    committedSelection: VoiceInputTextSelection | null,
  ): void {
    if (value === this.#value) {
      if (
        committedSelection !== null &&
        !sameSelection(this.#selection, committedSelection)
      ) {
        this.#freezeProvisional();
        this.#currentFinalSpan = undefined;
        this.#selection = toMutableSelection(committedSelection);
      }
      return;
    }

    const edit = findSingleEdit(this.#value, value);
    const delta = edit.newEnd - edit.oldEnd;
    const adjustedSelection = adjustSelectionForEdit(
      this.#selection,
      edit,
      delta,
    );
    const provisional = this.#provisional;
    const provisionalOverlaps =
      provisional !== undefined && spanOverlapsEdit(provisional, edit);

    this.#adjustSpansForEdit(edit.oldStart, edit.oldEnd, delta);
    this.#value = value;
    this.#selection = adjustedSelection;
    this.#currentFinalSpan = undefined;

    if (provisionalOverlaps) {
      this.#interimTranscript = "";
      this.#provisional = undefined;
    } else if (
      this.#provisional !== undefined &&
      !this.proveSpan(this.#provisional)
    ) {
      this.#abandonProvisional();
    }

    if (
      committedSelection !== null &&
      !sameSelection(this.#selection, committedSelection)
    ) {
      this.#freezeProvisional();
      this.#selection = toMutableSelection(committedSelection);
    }
  }

  selectionChanged(selection: VoiceInputTextSelection): void {
    if (sameSelection(this.#selection, selection)) {
      return;
    }
    this.#freezeProvisional();
    this.#currentFinalSpan = undefined;
    this.#selection = toMutableSelection(selection);
  }

  proveSpan(span: MutableTextSpan): boolean {
    return (
      this.#spans.includes(span) &&
      span.start >= 0 &&
      span.end >= span.start &&
      span.end <= this.#value.length &&
      this.#value.slice(span.start, span.end) === span.expectedText
    );
  }

  getSpanText(span: MutableTextSpan): string {
    return this.#value.slice(span.start, span.end);
  }

  canApplyTransform(
    span: MutableTextSpan,
    generation: number,
    originalText: string,
  ): boolean {
    return (
      span.generation === generation &&
      span.state === "finalized" &&
      this.proveSpan(span) &&
      this.#value.slice(span.start, span.end) === originalText
    );
  }

  applyTransform(span: MutableTextSpan, text: string): TextMutation {
    const replacement = this.#limitReplacement(
      span.start,
      span.end,
      normalizeInsertion(
        this.#value.slice(0, span.start),
        this.#value.slice(span.end),
        text,
      ),
    );
    const changed = this.#replaceText(
      span.start,
      span.end,
      replacement,
      span.id,
    );
    if (replacement.length === 0) {
      this.#spans = this.#spans.filter((candidate) => candidate !== span);
      this.#selection = {
        start: span.start,
        end: span.start,
        direction: "none",
        replacePending: false,
      };
    } else {
      span.end = span.start + replacement.length;
      span.state = "transformed";
      span.generation = this.#nextGeneration++;
      span.expectedText = replacement;
      this.#selection = {
        start: span.end,
        end: span.end,
        direction: "none",
        replacePending: false,
      };
    }
    return this.#createMutation(changed);
  }

  freezeFailedTransform(span: MutableTextSpan): void {
    if (span.state === "finalized" && this.proveSpan(span)) {
      span.state = "frozen";
      span.generation = this.#nextGeneration++;
    }
  }

  #insertAtAnchor(
    text: string,
    state: Extract<VoiceInputTextSpanState, "provisional" | "finalized">,
  ): { mutation: TextMutation; span: MutableTextSpan } | undefined {
    const selection = this.#selection;
    if (selection === null) {
      return undefined;
    }

    const start = selection.start;
    const end = selection.replacePending ? selection.end : selection.start;
    const replacement = this.#limitReplacement(
      start,
      end,
      normalizeInsertion(
        this.#value.slice(0, start),
        this.#value.slice(end),
        text,
      ),
    );
    if (replacement.length === 0) {
      return undefined;
    }

    selection.replacePending = false;
    const replacedText = this.#value.slice(start, end);
    const changed = this.#replaceText(start, end, replacement);
    const span: MutableTextSpan = {
      id: this.#nextSpanId++,
      start,
      end: start + replacement.length,
      state,
      runId: this.#runId,
      generation: this.#nextGeneration++,
      expectedText: replacement,
      ...(end > start ? { replacedText } : {}),
    };
    this.#spans.push(span);
    this.#selection = {
      start: span.end,
      end: span.end,
      direction: "none",
      replacePending: false,
    };
    return { mutation: this.#createMutation(changed), span };
  }

  #replaceOwnedSpan(
    span: MutableTextSpan,
    text: string,
    state: Extract<VoiceInputTextSpanState, "provisional" | "finalized">,
  ): { mutation: TextMutation; span?: MutableTextSpan } {
    const replacement = this.#limitReplacement(
      span.start,
      span.end,
      normalizeInsertion(
        this.#value.slice(0, span.start),
        this.#value.slice(span.end),
        text,
      ),
    );
    if (replacement.length === 0) {
      return { mutation: this.#removeOwnedSpan(span) };
    }

    const changed = this.#replaceText(
      span.start,
      span.end,
      replacement,
      span.id,
    );
    span.end = span.start + replacement.length;
    span.state = state;
    span.generation = this.#nextGeneration++;
    span.expectedText = replacement;
    if (state === "finalized") {
      delete span.replacedText;
    }
    this.#selection = {
      start: span.end,
      end: span.end,
      direction: "none",
      replacePending: false,
    };
    return { mutation: this.#createMutation(changed), span };
  }

  #removeOwnedSpan(span: MutableTextSpan): TextMutation {
    const start = span.start;
    const replacement = span.replacedText ?? "";
    const changed = this.#replaceText(start, span.end, replacement, span.id);
    this.#spans = this.#spans.filter((candidate) => candidate !== span);
    this.#selection = {
      start,
      end: start + replacement.length,
      direction: "none",
      replacePending: replacement.length > 0,
    };
    return this.#createMutation(changed);
  }

  #replaceText(
    start: number,
    end: number,
    replacement: string,
    excludedSpanId?: number,
  ): boolean {
    const previousValue = this.#value;
    const nextValue = `${previousValue.slice(0, start)}${replacement}${previousValue.slice(end)}`;
    if (nextValue === previousValue) {
      return false;
    }
    const delta = replacement.length - (end - start);
    this.#adjustSpansForEdit(start, end, delta, excludedSpanId);
    this.#value = nextValue;
    return true;
  }

  #mergeFinalizedSpan(span: MutableTextSpan): void {
    const previous = this.#currentFinalSpan;
    if (
      previous !== undefined &&
      previous !== span &&
      previous.state === "finalized" &&
      previous.runId === span.runId &&
      previous.end === span.start &&
      this.proveSpan(previous) &&
      this.proveSpan(span)
    ) {
      previous.end = span.end;
      previous.generation = this.#nextGeneration++;
      previous.expectedText = this.#value.slice(previous.start, previous.end);
      this.#spans = this.#spans.filter((candidate) => candidate !== span);
      this.#currentFinalSpan = previous;
      return;
    }
    this.#currentFinalSpan = span;
  }

  #freezeProvisional(): void {
    if (this.#provisional !== undefined) {
      this.#provisional.state = "frozen";
      this.#provisional.generation = this.#nextGeneration++;
      this.#provisional = undefined;
    }
    this.#interimTranscript = "";
    this.#currentFinalSpan = undefined;
  }

  #abandonProvisional(): void {
    const provisional = this.#provisional;
    if (provisional !== undefined) {
      this.#spans = this.#spans.filter((span) => span !== provisional);
      this.#provisional = undefined;
    }
    this.#interimTranscript = "";
    this.#currentFinalSpan = undefined;
  }

  #adjustSpansForEdit(
    start: number,
    end: number,
    delta: number,
    excludedSpanId?: number,
  ): void {
    const retained: MutableTextSpan[] = [];
    for (const span of this.#spans) {
      if (span.id === excludedSpanId) {
        retained.push(span);
      } else if (span.end <= start) {
        retained.push(span);
      } else if (span.start >= end) {
        span.start += delta;
        span.end += delta;
        retained.push(span);
      } else {
        if (span === this.#provisional) {
          this.#provisional = undefined;
        }
        if (span === this.#currentFinalSpan) {
          this.#currentFinalSpan = undefined;
        }
      }
    }
    this.#spans = retained;
  }

  #createMutation(changed: boolean): TextMutation {
    return {
      changed,
      selection: this.selection,
      value: this.#value,
    };
  }
}

export function normalizeInsertion(
  left: string,
  right: string,
  text: string,
): string {
  return normalizeTranscriptInsertion(left, right, text);
}

export function findSingleEdit(previous: string, next: string): TextEdit {
  let prefix = 0;
  const maximumPrefix = Math.min(previous.length, next.length);
  while (prefix < maximumPrefix && previous[prefix] === next[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  const maximumSuffix = Math.min(
    previous.length - prefix,
    next.length - prefix,
  );
  while (
    suffix < maximumSuffix &&
    previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
  ) {
    suffix += 1;
  }

  return {
    oldStart: prefix,
    oldEnd: previous.length - suffix,
    newEnd: next.length - suffix,
  };
}

export function adjustSelectionForEdit(
  selection: MutableTextSelection | null,
  edit: TextEdit,
  delta: number,
): MutableTextSelection | null {
  if (selection === null) {
    return null;
  }
  if (selection.end <= edit.oldStart) {
    return selection;
  }
  if (selection.start >= edit.oldEnd) {
    return {
      ...selection,
      start: selection.start + delta,
      end: selection.end + delta,
    };
  }
  return {
    start: edit.newEnd,
    end: edit.newEnd,
    direction: "none",
    replacePending: false,
  };
}

function spanOverlapsEdit(span: MutableTextSpan, edit: TextEdit): boolean {
  return !(span.end <= edit.oldStart || span.start >= edit.oldEnd);
}

function toMutableSelection(
  selection: VoiceInputTextSelection,
): MutableTextSelection {
  return {
    ...selection,
    replacePending: selection.start !== selection.end,
  };
}

function sameSelection(
  current: MutableTextSelection | null,
  next: VoiceInputTextSelection,
): boolean {
  return (
    current !== null &&
    current.start === next.start &&
    current.end === next.end &&
    (current.start === current.end || current.direction === next.direction)
  );
}
