import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import {
  VoiceInputError,
  createVoiceInputTextEngine,
  type VoiceInputTextEngine,
} from "./index.js";

const engines: VoiceInputTextEngine[] = [];

function createEngine(
  options: Parameters<typeof createVoiceInputTextEngine>[0] = {},
): VoiceInputTextEngine {
  const engine = createVoiceInputTextEngine(options);
  engines.push(engine);
  return engine;
}

function createTextarea(value = ""): HTMLTextAreaElement {
  const target = document.createElement("textarea");
  target.value = value;
  document.body.append(target);
  return target;
}

function activate(
  engine: VoiceInputTextEngine,
  target: HTMLTextAreaElement | HTMLInputElement,
  start = target.value.length,
  end = start,
): void {
  engine.setTarget(target);
  target.focus();
  target.setSelectionRange(start, end);
  engine.captureSelection();
  engine.begin();
}

function userInput(
  target: HTMLTextAreaElement,
  value: string,
  caret: number,
): void {
  target.dispatchEvent(
    new InputEvent("beforeinput", {
      bubbles: true,
      inputType: "insertText",
    }),
  );
  target.value = value;
  target.setSelectionRange(caret, caret);
  target.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

afterEach(() => {
  for (const engine of engines.splice(0)) {
    engine.destroy();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("text ownership", () => {
  it("freezes a disabled fieldset and never mutates a replacement with old speech", async () => {
    const target = createTextarea();
    const fieldset = document.createElement("fieldset");
    document.body.append(fieldset);
    fieldset.append(target);
    const engine = createEngine();
    const events: unknown[] = [];
    engine.subscribe((event) => events.push(event));
    activate(engine, target);
    engine.applyInterim("draft", "a");
    fieldset.disabled = true;
    await Promise.resolve();
    expect(engine.isWritable()).toBe(false);
    engine.applyFinal("changed", "a");
    engine.cancel();
    expect(target.value).toBe("draft");
    expect(events).toContainEqual({ type: "target-unavailable" });
    fieldset.disabled = false;
    engine.begin();
    engine.applyInterim("old", "old");
    const replacement = createTextarea("fresh");
    engine.setTarget(replacement);
    engine.captureSelection();
    engine.applyFinal("late", "new");
    expect(replacement.value).toBe("fresh");
    engine.undo();
    expect(replacement.value).toBe("fresh");
  });

  it("separates real typing, deletion, and voice history and intercepts browser history events", async () => {
    const target = createTextarea();
    const engine = createEngine();
    activate(engine, target);
    await userEvent.type(target, "abc");
    await userEvent.keyboard("{Backspace}");
    engine.applyFinal("voice", "a");
    await userEvent.keyboard("{ControlOrMeta>}z{/ControlOrMeta}");
    expect(target.value).toBe("ab");
    await userEvent.keyboard("{ControlOrMeta>}z{/ControlOrMeta}");
    expect(target.value).toBe("abc");
    const undoEvent = new InputEvent("beforeinput", {
      inputType: "historyUndo",
      cancelable: true,
      bubbles: true,
    });
    target.dispatchEvent(undoEvent);
    expect(undoEvent.defaultPrevented).toBe(true);
    expect(target.value).toBe("");
    target.dispatchEvent(
      new InputEvent("beforeinput", {
        inputType: "historyRedo",
        cancelable: true,
        bubbles: true,
      }),
    );
    expect(target.value).toBe("abc");
  });

  it("limits transforms and rejects late transforms after undo or loss of editability", async () => {
    const target = createTextarea();
    target.maxLength = 5;
    const engine = createEngine({ transformTranscript: async () => "👍🏽abcd" });
    activate(engine, target);
    engine.applyFinal("hi", "a");
    await engine.complete().result;
    expect(target.value).toBe("👍🏽a");
    engine.undo();
    expect(target.value).toBe("hi");
    for (const action of ["undo", "readOnly"] as const) {
      let resolve!: (text: string) => void;
      engine.updateOptions({
        transformTranscript: () =>
          new Promise<string>((r) => {
            resolve = r;
          }),
      });
      engine.begin();
      engine.applyFinal("!", action);
      const completion = engine.complete();
      if (action === "undo") engine.undo();
      else target.readOnly = true;
      const frozen = target.value;
      resolve("late");
      await completion.result;
      expect(target.value).toBe(frozen);
    }
  });
  it("groups revisions into one undo step and never resurrects an undone phrase", async () => {
    const target = createTextarea("before");
    const engine = createEngine();
    activate(engine, target);
    engine.applyInterim("one", "a");
    engine.applyInterim("one revised", "a");
    engine.applyFinal("one revised.", "a");
    engine.applyFinal("two", "b");
    engine.undo();
    expect(target.value).toBe("before one revised.");
    engine.undo();
    expect(target.value).toBe("before");
    engine.redo();
    expect(target.value).toBe("before one revised.");
    engine.applyFinal("late duplicate", "a");
    expect(target.value).toBe("before one revised.");
    engine.applyInterim("draft", "c");
    await userEvent.keyboard("{ControlOrMeta>}z{/ControlOrMeta}");
    engine.applyFinal("draft corrected", "c");
    expect(target.value).toBe("before one revised.");
  });

  it("keeps identical text from distinct segments and ignores duplicate finals", () => {
    const target = createTextarea();
    const engine = createEngine();
    activate(engine, target);
    engine.applyFinal("yes", "a");
    engine.applyFinal("yes", "a");
    engine.applyFinal("yes", "b");
    expect(target.value).toBe("yes yes");
  });

  it("restores replaced text and its selection through undo and redo", () => {
    const target = createTextarea("keep old end");
    const engine = createEngine();
    activate(engine, target, 5, 8);
    engine.applyFinal("new", "a");
    engine.undo();
    expect(target.value).toBe("keep old end");
    expect([target.selectionStart, target.selectionEnd]).toEqual([5, 8]);
    engine.redo();
    expect(target.value).toBe("keep new end");
  });

  it("limits whole graphemes without trimming neighboring application text", () => {
    const target = createTextarea("L old R");
    target.maxLength = 8;
    const engine = createEngine();
    const limits: unknown[] = [];
    engine.subscribe((event) => limits.push(event));
    activate(engine, target, 2, 5);
    engine.applyFinal("👍🏽 hello", "a");
    expect(target.value).toBe("L 👍🏽 R");
    expect(limits).toEqual([
      expect.objectContaining({
        type: "text-limit",
        maxLength: 8,
        source: "final",
      }),
    ]);
    engine.applyFinal("extra", "b");
    expect(target.value).toBe("L 👍🏽 R");
  });

  it("protects composition and resumes insertion with a subsequent segment", async () => {
    const target = createTextarea();
    const engine = createEngine();
    activate(engine, target);
    target.dispatchEvent(new CompositionEvent("compositionstart"));
    userInput(target, "日本", 2);
    engine.applyInterim("ignored", "a");
    expect(target.value).toBe("日本");
    target.dispatchEvent(new CompositionEvent("compositionend"));
    await Promise.resolve();
    engine.applyFinal("ignored final", "a");
    engine.applyFinal("語", "b");
    expect(target.value).toBe("日本語");
  });

  it("does not apply pending speech or transforms after form reset", async () => {
    const target = createTextarea();
    const form = document.createElement("form");
    document.body.append(form);
    form.append(target);
    let resolve!: (text: string) => void;
    const engine = createEngine({
      transformTranscript: () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    });
    activate(engine, target);
    engine.applyFinal("original", "a");
    const completion = engine.complete();
    form.reset();
    await Promise.resolve();
    resolve("late transform");
    await completion.result;
    engine.applyFinal("late speech", "b");
    engine.undo();
    expect(target.value).toBe("");
  });

  it("mounts disabled and read-only native fields without changing them", () => {
    for (const attribute of ["disabled", "readOnly"] as const) {
      const target = createTextarea("keep");
      target[attribute] = true;
      const engine = createEngine();
      expect(() => engine.setTarget(target)).not.toThrow();
      engine.begin();
      engine.applyFinal("ignored");
      expect(target.value).toBe("keep");
    }
  });

  it("does not resurrect a corrected provisional phrase", () => {
    const target = createTextarea();
    const engine = createEngine();
    activate(engine, target);
    engine.applyInterim("Book flight");
    userInput(target, "Book train", 10);
    engine.applyFinal("Book flight tomorrow.");
    expect(target.value).toBe("Book train");
    engine.applyFinal("Thank you.");
    expect(target.value).toBe("Book train Thank you.");
  });

  it("undoes finalized speech with the real keyboard", async () => {
    const target = createTextarea();
    const engine = createEngine();
    activate(engine, target);
    await userEvent.type(target, "typed");
    engine.applyFinal("spoken");
    expect(target.value).toBe("typed spoken");
    await userEvent.keyboard("{ControlOrMeta>}z{/ControlOrMeta}");
    expect(target.value).toBe("typed");
  });

  it("respects maxLength and a target that becomes read-only", () => {
    const target = createTextarea();
    target.maxLength = 5;
    const engine = createEngine();
    activate(engine, target);
    engine.applyFinal("hello world");
    expect(target.value).toBe("hello");
    target.removeAttribute("maxlength");
    engine.applyInterim("draft");
    const value = target.value;
    target.readOnly = true;
    engine.applyFinal("rewritten while read only");
    expect(target.value).toBe(value);
  });

  it("captures a selection before blur and replaces only the provisional range", () => {
    const target = createTextarea("Say old now");
    const trigger = document.createElement("button");
    document.body.append(trigger);
    const engine = createEngine();
    const inputEvents = vi.fn<() => void>();
    target.addEventListener("input", inputEvents);

    engine.setTarget(target);
    target.focus();
    target.setSelectionRange(4, 7, "backward");
    expect(engine.captureSelection()).toEqual({
      start: 4,
      end: 7,
      direction: "backward",
    });
    trigger.focus();
    engine.begin();

    engine.applyInterim("hello");
    engine.applyInterim("hello there");
    engine.applyFinal("hello there");
    engine.applyFinal("world");

    expect(target.value).toBe("Say hello there world now");
    expect(inputEvents).toHaveBeenCalledTimes(3);
    const snapshot = engine.getSnapshot();
    expect(snapshot.spans).toEqual([
      expect.objectContaining({
        text: "hello there world",
        state: "finalized",
      }),
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.spans)).toBe(true);
    expect(Object.isFrozen(snapshot.spans[0])).toBe(true);
  });

  it("does not replace a selection without transcript and restores it on cancel", () => {
    const target = createTextarea("keep selected text");
    const engine = createEngine();
    activate(engine, target, 5, 13);

    engine.cancel();
    expect(target.value).toBe("keep selected text");

    engine.begin();
    engine.applyInterim("temporary");
    expect(target.value).toBe("keep temporary text");
    engine.cancel();
    expect(target.value).toBe("keep selected text");
    expect(target.selectionStart).toBe(5);
    expect(target.selectionEnd).toBe(13);
  });

  it("freezes manual edits and re-anchors subsequent speech", () => {
    const target = createTextarea();
    const engine = createEngine();
    activate(engine, target);
    engine.applyInterim("hello");

    userInput(target, "hello!", 6);
    engine.applyInterim("world", "next-phrase");

    expect(target.value).toBe("hello! world");
    expect(engine.getSnapshot().spans.map((span) => span.state)).toEqual([
      "frozen",
      "provisional",
    ]);

    target.setSelectionRange(0, 0);
    target.dispatchEvent(new Event("select", { bubbles: true }));
    engine.applyInterim("new", "third-phrase");
    expect(target.value).toBe("new hello! world");
    expect(engine.getSnapshot().spans.at(-1)?.state).toBe("provisional");
  });

  it("keeps exposed interim text out of the target until finalization", () => {
    const target = createTextarea("Before after");
    const engine = createEngine({ interimBehavior: "expose" });
    activate(engine, target, 7, 7);

    engine.applyInterim("preview");
    expect(target.value).toBe("Before after");
    expect(engine.getSnapshot().interimTranscript).toBe("preview");

    engine.applyFinal("spoken");
    expect(target.value).toBe("Before spoken after");
    expect(engine.getSnapshot().interimTranscript).toBe("");
  });

  it("commits a trusted provisional span on clean completion", async () => {
    const target = createTextarea();
    const engine = createEngine();
    activate(engine, target);
    engine.applyInterim("provider preview");

    const completion = engine.complete();
    expect(completion.processing).toBe(false);
    await expect(completion.result).resolves.toEqual([]);
    expect(target.value).toBe("provider preview");
    expect(engine.getSnapshot().spans[0]?.state).toBe("finalized");
  });

  it("normalizes only insertion boundaries and respects punctuation", () => {
    const cases = [
      {
        value: "one two",
        caret: 3,
        text: " middle ",
        expected: "one middle two",
      },
      {
        value: "Hello!Next",
        caret: 6,
        text: "again",
        expected: "Hello! again Next",
      },
      { value: "call()", caret: 5, text: "me", expected: "call(me)" },
      {
        value: "",
        caret: 0,
        text: "  exact   interior  ",
        expected: "exact   interior",
      },
    ];

    for (const testCase of cases) {
      const target = createTextarea(testCase.value);
      const engine = createEngine();
      activate(engine, target, testCase.caret);
      engine.applyFinal(testCase.text);
      expect(target.value).toBe(testCase.expected);
      engine.destroy();
    }
  });
});

describe("controlled reconciliation", () => {
  it("keeps revising shadow text while controlled commits are deferred", () => {
    let committedValue = "Say old now";
    const changes: string[] = [];
    const target = createTextarea(committedValue);
    const engine = createEngine({
      controlled: {
        getValue: () => committedValue,
        onValueChange(nextValue) {
          changes.push(nextValue);
        },
      },
    });
    activate(engine, target, 4, 7);

    engine.applyInterim("hello");
    engine.applyInterim("hello there");
    engine.applyFinal("hello there");

    expect(target.value).toBe("Say hello there now");
    expect(changes).toEqual(["Say hello now", "Say hello there now"]);
    committedValue = changes.at(-1) ?? committedValue;
    engine.reconcileControlledValue(committedValue);
    expect(target.value).toBe(committedValue);
  });

  it("replaces an uncommitted interim with a provider final", () => {
    const committedValue = "Say old now";
    const changes: string[] = [];
    const target = createTextarea(committedValue);
    const engine = createEngine({
      controlled: {
        getValue: () => committedValue,
        onValueChange(nextValue) {
          changes.push(nextValue);
        },
      },
    });
    activate(engine, target, 4, 7);

    engine.applyInterim("hel");
    engine.applyFinal("hello");

    expect(target.value).toBe("Say hello now");
    expect(changes).toEqual(["Say hel now", "Say hello now"]);
  });

  it.each([
    {
      label: "before",
      update: (value: string) => `prefix ${value}`,
      expected: "prefix alpha changed omega",
    },
    {
      label: "after",
      update: (value: string) => `${value} suffix`,
      expected: "alpha changed omega suffix",
    },
  ])(
    "preserves a provisional span after a disjoint edit $label it",
    (testCase) => {
      let committedValue = "alpha omega";
      const changes: string[] = [];
      const target = createTextarea(committedValue);
      const engine = createEngine({
        controlled: {
          getValue: () => committedValue,
          onValueChange(nextValue) {
            changes.push(nextValue);
          },
        },
      });
      activate(engine, target, 6);
      engine.applyInterim("voice");

      committedValue = testCase.update(changes.at(-1) ?? committedValue);
      engine.reconcileControlledValue(committedValue);
      engine.applyInterim("changed");

      expect(target.value).toBe(testCase.expected);
      expect(engine.getSnapshot().spans.at(-1)?.state).toBe("provisional");
    },
  );

  it("uses the binding without input events and shifts proven ranges", () => {
    let value = "alpha omega";
    const changes: string[] = [];
    const target = createTextarea(value);
    const engine = createEngine({
      controlled: {
        getValue: () => value,
        onValueChange(nextValue) {
          value = nextValue;
          changes.push(nextValue);
        },
      },
    });
    const inputEvents = vi.fn<() => void>();
    target.addEventListener("input", inputEvents);
    activate(engine, target, 6);
    engine.applyFinal("middle");

    expect(value).toBe("alpha middle omega");
    expect(target.value).toBe(value);
    expect(changes).toEqual([value]);
    expect(inputEvents).not.toHaveBeenCalled();

    value = `prefix ${value}`;
    engine.reconcileControlledValue(value);
    expect(engine.getSnapshot().spans[0]).toMatchObject({
      start: 13,
      text: "middle ",
      state: "finalized",
    });
  });

  it("abandons ownership when an external update overlaps a span", () => {
    let value = "start end";
    const target = createTextarea(value);
    const engine = createEngine({
      controlled: {
        getValue: () => value,
        onValueChange(nextValue) {
          value = nextValue;
        },
      },
      transformTranscript: (text) => text.toUpperCase(),
    });
    activate(engine, target, 6);
    engine.applyFinal("voice");

    value = value.replace("voice", "application");
    engine.reconcileControlledValue(value);
    const completion = engine.complete();

    expect(completion.processing).toBe(false);
    expect(engine.getSnapshot().spans).toEqual([]);
    expect(target.value).toBe("start application end");
  });

  it("freezes provisional text and adopts a committed controlled selection", () => {
    let value = "base";
    const target = createTextarea(value);
    const engine = createEngine({
      controlled: {
        getValue: () => value,
        onValueChange(nextValue) {
          value = nextValue;
        },
      },
    });
    activate(engine, target, 4);
    engine.applyInterim("voice");

    value = `${value} app`;
    target.value = value;
    target.setSelectionRange(0, 0);
    engine.reconcileControlledValue(value);
    engine.applyInterim("new", "third-phrase");

    expect(target.value).toBe("new base voice app");
    expect(engine.getSnapshot().spans.map((span) => span.state)).toEqual([
      "frozen",
      "provisional",
    ]);
  });

  it("re-anchors when a controlled commit moves the selection", () => {
    let value = "base";
    const target = createTextarea(value);
    const engine = createEngine({
      controlled: {
        getValue: () => value,
        onValueChange(nextValue) {
          value = nextValue;
        },
      },
    });
    activate(engine, target, 4);
    engine.applyInterim("voice");

    target.setSelectionRange(0, 0);
    engine.reconcileControlledValue(value);
    engine.applyInterim("new", "third-phrase");

    expect(target.value).toBe("new base voice");
    expect(engine.getSnapshot().spans.map((span) => span.state)).toEqual([
      "frozen",
      "provisional",
    ]);
  });
});

describe("transforms", () => {
  it("transforms one contiguous finalized span once", async () => {
    const transform = vi.fn<(text: string) => Promise<string>>(async (text) =>
      text.toUpperCase(),
    );
    const target = createTextarea();
    const engine = createEngine({ transformTranscript: transform });
    activate(engine, target);
    engine.applyFinal("hello");
    engine.applyFinal("world");

    const completion = engine.complete();
    expect(completion.processing).toBe(true);
    await expect(completion.result).resolves.toEqual([]);

    expect(transform).toHaveBeenCalledOnce();
    expect(transform).toHaveBeenCalledWith("hello world");
    expect(target.value).toBe("HELLO WORLD");
    expect(engine.getSnapshot().spans[0]?.state).toBe("transformed");
  });

  it("runs re-anchored spans concurrently and permits an empty result", async () => {
    const resolvers: Array<(value: string) => void> = [];
    const transform = vi.fn<() => Promise<string>>(
      () =>
        new Promise<string>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const target = createTextarea();
    const engine = createEngine({ transformTranscript: transform });
    activate(engine, target);
    engine.applyFinal("first");
    target.setSelectionRange(0, 0);
    target.dispatchEvent(new Event("select", { bubbles: true }));
    engine.applyFinal("second");

    const completion = engine.complete();
    expect(transform).toHaveBeenCalledTimes(2);
    resolvers[0]?.("FIRST");
    resolvers[1]?.("");
    await expect(completion.result).resolves.toEqual([]);
    expect(target.value).toBe("FIRST");
  });

  it("does not overwrite a span edited while its transform is pending", async () => {
    let resolveTransform: (value: string) => void = () => {};
    const target = createTextarea();
    const engine = createEngine({
      transformTranscript: () =>
        new Promise<string>((resolve) => {
          resolveTransform = resolve;
        }),
    });
    activate(engine, target);
    engine.applyFinal("faithful");
    const completion = engine.complete();

    userInput(target, "user edit", 9);
    resolveTransform("OVERWRITE");
    await expect(completion.result).resolves.toEqual([]);
    expect(target.value).toBe("user edit");
  });

  it("retains provider text on rejection and timeout", async () => {
    const rejectedTarget = createTextarea();
    const rejected = createEngine({
      transformTranscript: () => Promise.reject(new Error("nope")),
    });
    activate(rejected, rejectedTarget);
    rejected.applyFinal("original");
    const rejectedErrors = await rejected.complete().result;
    expect(rejectedTarget.value).toBe("original");
    expect(rejectedErrors[0]).toMatchObject({ code: "transform-error" });

    let resolveTimed: (value: string) => void = () => {};
    const timedTarget = createTextarea();
    const timed = createEngine({
      transformTranscript: () =>
        new Promise<string>((resolve) => {
          resolveTimed = resolve;
        }),
      transformTimeoutMs: 10,
    });
    activate(timed, timedTarget);
    timed.applyFinal("still here");
    const timedErrors = await timed.complete().result;
    expect(timedTarget.value).toBe("still here");
    expect(timedErrors[0]?.message).toMatch(/timed out/);
    resolveTimed("too late");
    await Promise.resolve();
    expect(timedTarget.value).toBe("still here");
  });

  it("treats a non-string transform result as a non-destructive error", async () => {
    const target = createTextarea();
    const invalidTransform = (() => 42) as unknown as (text: string) => string;
    const engine = createEngine({ transformTranscript: invalidTransform });
    activate(engine, target);
    engine.applyFinal("faithful");

    const errors = await engine.complete().result;
    expect(errors[0]).toMatchObject({ code: "transform-error" });
    expect(target.value).toBe("faithful");
  });

  it("ignores late results after detaching the target", async () => {
    let resolveTransform: (value: string) => void = () => {};
    const target = createTextarea();
    const engine = createEngine({
      transformTranscript: () =>
        new Promise<string>((resolve) => {
          resolveTransform = resolve;
        }),
    });
    activate(engine, target);
    engine.applyFinal("original");
    const completion = engine.complete();
    engine.setTarget(null);
    resolveTransform("late");

    await expect(completion.result).resolves.toEqual([]);
    expect(target.value).toBe("original");
  });
});

describe("target validation", () => {
  it("validates text-engine configuration", () => {
    expect(() => createVoiceInputTextEngine({ transformTimeoutMs: 0 })).toThrow(
      /transformTimeoutMs/,
    );
    expect(() =>
      createVoiceInputTextEngine({
        interimBehavior: "invalid" as "inline",
      }),
    ).toThrow(/interimBehavior/);
  });

  it.each(["email", "password", "number", "date"])(
    "rejects input type %s",
    (type) => {
      const input = document.createElement("input");
      input.type = type;
      const engine = createEngine();
      expect(() => engine.setTarget(input)).toThrow(VoiceInputError);
    },
  );

  it("accepts readonly and disabled targets without granting write access", () => {
    const readonly = createTextarea();
    readonly.readOnly = true;
    const disabled = createTextarea();
    disabled.disabled = true;
    const engine = createEngine();
    expect(() => engine.setTarget(readonly)).not.toThrow();
    expect(engine.isWritable()).toBe(false);
    expect(() => engine.setTarget(disabled)).not.toThrow();
    expect(engine.isWritable()).toBe(false);
  });

  it.each(["text", "search", "url", "tel"])(
    "supports input type %s",
    (type) => {
      const input = document.createElement("input");
      input.type = type;
      document.body.append(input);
      const engine = createEngine();
      activate(engine, input);
      engine.applyFinal("works");
      expect(input.value).toBe("works");
    },
  );
});
