import { VoiceInputError } from "@voiceinput/provider";

import type {
  VoiceInputControlledTextBinding,
  VoiceInputTextSelection,
  VoiceInputTextTarget,
} from "./types.js";
import type { TextMutation } from "./ownership-model.js";

const SUPPORTED_INPUT_TYPES = new Set(["text", "search", "url", "tel"]);

export interface TextTargetCallbacks {
  readonly onBeforeInput: (inputType: string) => void;
  readonly onHistory: (redo: boolean) => void;
  readonly onComposition: (active: boolean) => void;
  readonly onReset: () => void;
  readonly onAvailability: () => void;
  readonly onInput: () => void;
  readonly onSelectionChange: () => void;
  readonly onUnhandledError: (error: unknown) => void;
}

export class TextTargetAdapter {
  readonly #controlled: VoiceInputControlledTextBinding | undefined;
  readonly #callbacks: TextTargetCallbacks;

  #target: VoiceInputTextTarget | null = null;
  #writeDepth = 0;
  #observer: MutationObserver | undefined;
  #form: HTMLFormElement | null = null;
  #composing = false;

  constructor(
    controlled: VoiceInputControlledTextBinding | undefined,
    callbacks: TextTargetCallbacks,
  ) {
    this.#controlled = controlled;
    this.#callbacks = callbacks;
  }

  get target(): VoiceInputTextTarget | null {
    return this.#target;
  }

  get isControlled(): boolean {
    return this.#controlled !== undefined;
  }

  attach(target: VoiceInputTextTarget): string {
    assertSupportedTarget(target);
    this.detach();
    this.#target = target;
    const value = this.#controlled?.getValue() ?? target.value;
    this.#withGuard(() => {
      if (target.value !== value) target.value = value;
    });
    target.addEventListener("beforeinput", this.#handleBeforeInput);
    target.addEventListener("keydown", this.#handleKeyDown);
    target.addEventListener("compositionstart", this.#handleCompositionStart);
    target.addEventListener("compositionend", this.#handleCompositionEnd);
    this.#form = target.form;
    this.#form?.addEventListener("reset", this.#handleReset);
    this.#observer = new MutationObserver(() =>
      this.#callbacks.onAvailability(),
    );
    this.#observer.observe(target, {
      attributes: true,
      attributeFilter: ["disabled", "readonly", "type", "maxlength"],
    });
    for (
      let ancestor = target.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      this.#observer.observe(ancestor, {
        attributes: true,
        attributeFilter: ["disabled"],
      });
    }
    target.addEventListener("input", this.#handleInput);
    target.addEventListener("select", this.#handleSelectionChange);
    target.ownerDocument.addEventListener(
      "selectionchange",
      this.#handleSelectionChange,
    );
    return value;
  }

  detach(): void {
    const target = this.#target;
    if (target === null) {
      return;
    }
    target.removeEventListener("beforeinput", this.#handleBeforeInput);
    target.removeEventListener("keydown", this.#handleKeyDown);
    target.removeEventListener(
      "compositionstart",
      this.#handleCompositionStart,
    );
    target.removeEventListener("compositionend", this.#handleCompositionEnd);
    this.#form?.removeEventListener("reset", this.#handleReset);
    this.#form = null;
    this.#observer?.disconnect();
    this.#observer = undefined;
    this.#composing = false;
    target.removeEventListener("input", this.#handleInput);
    target.removeEventListener("select", this.#handleSelectionChange);
    target.ownerDocument.removeEventListener(
      "selectionchange",
      this.#handleSelectionChange,
    );
    this.#target = null;
  }

  isWritable(): boolean {
    return (
      this.#target !== null &&
      isSupportedTarget(this.#target) &&
      !this.#target.matches(":disabled") &&
      !this.#target.readOnly
    );
  }

  readValue(): string {
    return this.#target?.value ?? "";
  }

  readSelection(): VoiceInputTextSelection | null {
    return this.#target === null || !isSupportedTarget(this.#target)
      ? null
      : readSelection(this.#target);
  }

  readSelectionWhenValueIs(value: string): VoiceInputTextSelection | null {
    return this.#target !== null &&
      isSupportedTarget(this.#target) &&
      this.#target.value === value
      ? readSelection(this.#target)
      : null;
  }

  applyMutation(mutation: TextMutation): void {
    const target = this.#target;
    if (target === null || !this.isWritable() || this.#composing) {
      return;
    }
    this.#withGuard(() => {
      setNativeValue(target, mutation.value);
      restoreSelection(target, mutation.selection);
      if (!mutation.changed) {
        return;
      }
      try {
        if (!this.#controlled?.dispatchInput)
          this.#controlled?.onValueChange(mutation.value);
      } catch (error) {
        this.#callbacks.onUnhandledError(error);
      }
      if (this.#controlled === undefined || this.#controlled.dispatchInput) {
        const InputEventConstructor =
          target.ownerDocument.defaultView?.InputEvent ?? InputEvent;
        target.dispatchEvent(
          new InputEventConstructor("input", {
            bubbles: true,
            inputType: "insertText",
          }),
        );
      }
    });
  }

  synchronize(value: string, selection: VoiceInputTextSelection | null): void {
    const target = this.#target;
    if (target === null || !isSupportedTarget(target) || this.#composing) {
      return;
    }
    this.#withGuard(() => {
      if (target.value !== value) target.value = value;
      restoreSelection(target, selection);
    });
  }

  #handleBeforeInput = (event: Event): void => {
    if (this.#writeDepth !== 0) return;
    const inputType = (event as InputEvent).inputType ?? "insertText";
    if (inputType === "historyUndo" || inputType === "historyRedo") {
      if (event.cancelable && !this.#composing) {
        event.preventDefault();
        this.#callbacks.onHistory(inputType === "historyRedo");
      }
      return;
    }
    this.#callbacks.onBeforeInput(inputType);
  };

  #handleKeyDown = (rawEvent: Event): void => {
    const event = rawEvent as KeyboardEvent;
    if (
      event.defaultPrevented ||
      event.isComposing ||
      this.#composing ||
      !this.isWritable()
    )
      return;
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (
      modifier &&
      !event.altKey &&
      (key === "z" || (event.ctrlKey && key === "y"))
    ) {
      event.preventDefault();
      this.#callbacks.onHistory(key === "y" || event.shiftKey);
    }
  };

  #handleCompositionStart = (): void => {
    this.#composing = true;
    this.#callbacks.onComposition(true);
  };

  #handleCompositionEnd = (): void => {
    this.#composing = false;
    // The browser commits the last composition input before the microtask.
    const target = this.#target;
    queueMicrotask(() => {
      if (target === this.#target) this.#callbacks.onComposition(false);
    });
  };

  #handleReset = (event: Event): void => {
    const target = this.#target;
    queueMicrotask(() => {
      if (!event.defaultPrevented && target === this.#target)
        this.#callbacks.onReset();
    });
  };

  #handleInput = (): void => {
    if (this.#writeDepth === 0) {
      this.#callbacks.onInput();
    }
  };

  #handleSelectionChange = (): void => {
    if (this.#writeDepth === 0) {
      this.#callbacks.onSelectionChange();
    }
  };

  #withGuard(operation: () => void): void {
    this.#writeDepth += 1;
    try {
      operation();
    } finally {
      this.#writeDepth -= 1;
    }
  }
}

function assertSupportedTarget(target: VoiceInputTextTarget): void {
  if (!isSupportedTarget(target)) {
    throw invalidTarget();
  }
}

function isSupportedTarget(
  target: VoiceInputTextTarget,
): target is VoiceInputTextTarget {
  if (typeof target !== "object" || target === null) {
    return false;
  }
  if (target.tagName === "TEXTAREA") {
    return true;
  }
  return target.tagName === "INPUT" && SUPPORTED_INPUT_TYPES.has(target.type);
}

function readSelection(target: VoiceInputTextTarget): VoiceInputTextSelection {
  const start = target.selectionStart;
  const end = target.selectionEnd;
  if (start === null || end === null) {
    throw invalidTarget("The text target does not expose a selection.");
  }
  const direction = target.selectionDirection;
  return {
    start,
    end,
    direction:
      direction === "forward" || direction === "backward" ? direction : "none",
  };
}

function restoreSelection(
  target: VoiceInputTextTarget,
  selection: VoiceInputTextSelection | null,
): void {
  if (selection === null) {
    return;
  }
  const start = Math.min(selection.start, target.value.length);
  const end = Math.min(selection.end, target.value.length);
  target.setSelectionRange(start, end, selection.direction);
}

function invalidTarget(
  message = "Text targets must be <textarea> elements or <input> elements of type text, search, url, or tel.",
): VoiceInputError {
  return new VoiceInputError({ code: "invalid-configuration", message });
}

function setNativeValue(target: VoiceInputTextTarget, value: string): void {
  const view = target.ownerDocument.defaultView;
  const prototype =
    target.tagName === "TEXTAREA"
      ? view?.HTMLTextAreaElement.prototype
      : view?.HTMLInputElement.prototype;
  const descriptor =
    prototype && Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor?.set) descriptor.set.call(target, value);
  else target.value = value;
}
