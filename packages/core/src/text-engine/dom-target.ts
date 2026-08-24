import { VoiceInputError } from "@voiceinput/provider";

import type {
  VoiceInputControlledTextBinding,
  VoiceInputTextSelection,
  VoiceInputTextTarget,
} from "./types.js";
import type { TextMutation } from "./ownership-model.js";

const SUPPORTED_INPUT_TYPES = new Set(["text", "search", "url", "tel"]);

export interface TextTargetCallbacks {
  readonly onBeforeInput: () => void;
  readonly onInput: () => void;
  readonly onSelectionChange: () => void;
  readonly onUnhandledError: (error: unknown) => void;
}

export class TextTargetAdapter {
  readonly #controlled: VoiceInputControlledTextBinding | undefined;
  readonly #callbacks: TextTargetCallbacks;

  #target: VoiceInputTextTarget | null = null;
  #writeDepth = 0;

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
      target.value = value;
    });
    target.addEventListener("beforeinput", this.#handleBeforeInput);
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
    target.removeEventListener("input", this.#handleInput);
    target.removeEventListener("select", this.#handleSelectionChange);
    target.ownerDocument.removeEventListener(
      "selectionchange",
      this.#handleSelectionChange,
    );
    this.#target = null;
  }

  isWritable(): boolean {
    return this.#target !== null && isWritableSupportedTarget(this.#target);
  }

  readValue(): string {
    return this.#target?.value ?? "";
  }

  readSelection(): VoiceInputTextSelection | null {
    return this.#target === null ? null : readSelection(this.#target);
  }

  readSelectionWhenValueIs(value: string): VoiceInputTextSelection | null {
    return this.#target !== null && this.#target.value === value
      ? readSelection(this.#target)
      : null;
  }

  applyMutation(mutation: TextMutation): void {
    const target = this.#target;
    if (target === null) {
      return;
    }
    this.#withGuard(() => {
      target.value = mutation.value;
      restoreSelection(target, mutation.selection);
      if (!mutation.changed) {
        return;
      }
      if (this.#controlled === undefined) {
        const EventConstructor =
          target.ownerDocument.defaultView?.Event ?? Event;
        target.dispatchEvent(new EventConstructor("input", { bubbles: true }));
      } else {
        try {
          this.#controlled.onValueChange(mutation.value);
        } catch (error) {
          this.#callbacks.onUnhandledError(error);
        }
      }
    });
  }

  synchronize(value: string, selection: VoiceInputTextSelection | null): void {
    const target = this.#target;
    if (target === null) {
      return;
    }
    this.#withGuard(() => {
      target.value = value;
      restoreSelection(target, selection);
    });
  }

  #handleBeforeInput = (): void => {
    if (this.#writeDepth === 0) {
      this.#callbacks.onBeforeInput();
    }
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
  if (!isWritableSupportedTarget(target)) {
    throw invalidTarget();
  }
}

function isWritableSupportedTarget(
  target: VoiceInputTextTarget,
): target is VoiceInputTextTarget {
  if (
    typeof target !== "object" ||
    target === null ||
    target.disabled ||
    target.readOnly
  ) {
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
  message = "Text targets must be writable <textarea> elements or <input> elements of type text, search, url, or tel.",
): VoiceInputError {
  return new VoiceInputError({ code: "invalid-configuration", message });
}
