import type {
  PreparedVoiceAudioSource,
  VoiceAudioSource,
  VoiceInputSessionEvent,
  VoiceInputTextEngineSnapshot,
} from "@voiceinput/core";
import { createFakeVoiceInputProvider } from "@voiceinput/provider/test";
import type { VoiceInputProviderV1 } from "@voiceinput/provider";
import { act, StrictMode, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VoiceInputProvider, useVoiceInput } from "./index.js";
import type { VoiceInputActivationMode } from "./types.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
  });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("useVoiceInput", () => {
  it("inserts into a controlled field at the selection captured before blur", async () => {
    const fake = createFakeVoiceInputProvider();
    const audioSource = createFakeAudioSource();
    const statuses: string[] = [];
    render(
      <VoiceInputProvider provider={fake.provider} audioSource={audioSource}>
        <ControlledField onStatus={(status) => statuses.push(status)} />
      </VoiceInputProvider>,
    );
    const textarea = getTextarea("controlled");
    const button = getButton("controlled trigger");
    await waitForEnabled(button);
    textarea.focus();
    textarea.setSelectionRange(4, 7);

    await act(async () => {
      button.dispatchEvent(pointerEvent("pointerdown", 1));
      button.click();
      await fake.controller.waitForSession();
    });
    expect(button.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      fake.controller.emit({ type: "interim", text: "hel" });
      fake.controller.emit({ type: "final", text: "hello" });
      fake.controller.emit({ type: "final", text: "world" });
    });
    await vi.waitFor(() => expect(textarea.value).toBe("Say hello world now"));

    await act(async () => {
      button.click();
    });
    await vi.waitFor(() =>
      expect(button.getAttribute("aria-pressed")).toBe("false"),
    );
    expect(statuses).toEqual([
      "requesting-permission",
      "connecting",
      "listening",
      "stopping",
      "idle",
    ]);
  });

  it("preserves ownership when a deferred controlled echo commits", async () => {
    const fake = createFakeVoiceInputProvider();
    const changes: string[] = [];
    let commitValue: (value: string) => void = () => {};
    let readSnapshot: (() => VoiceInputTextEngineSnapshot) | undefined;
    render(
      <VoiceInputProvider
        provider={fake.provider}
        audioSource={createFakeAudioSource()}
      >
        <DeferredControlledField
          exposeCommit={(commit) => (commitValue = commit)}
          exposeSnapshot={(read) => (readSnapshot = read)}
          onValueChange={(value) => changes.push(value)}
        />
      </VoiceInputProvider>,
    );
    const textarea = getTextarea("deferred controlled");
    const button = getButton("deferred controlled trigger");
    await waitForEnabled(button);

    await act(async () => {
      button.click();
      await fake.controller.waitForSession();
      fake.controller.emit({ type: "interim", text: "a" });
      fake.controller.emit({ type: "interim", text: "ab" });
      fake.controller.emit({ type: "interim", text: "a" });
      fake.controller.emit({ type: "final", text: "alpha" });
    });
    await vi.waitFor(() => expect(changes).toHaveLength(4));

    act(() => commitValue(changes.at(-1) ?? ""));
    expect(textarea.value).toBe("alpha");
    expect(readSnapshot?.().spans).toMatchObject([
      { state: "finalized", text: "alpha" },
    ]);
  });

  it("forgets a rejected echo before the value is reused", async () => {
    const fake = createFakeVoiceInputProvider();
    const changes: string[] = [];
    let commitValue: (value: string) => void = () => {};
    render(
      <VoiceInputProvider
        provider={fake.provider}
        audioSource={createFakeAudioSource()}
      >
        <DeferredControlledField
          exposeCommit={(commit) => (commitValue = commit)}
          exposeSnapshot={() => {}}
          onValueChange={(value) => changes.push(value)}
        />
      </VoiceInputProvider>,
    );
    const textarea = getTextarea("deferred controlled");
    const button = getButton("deferred controlled trigger");
    await waitForEnabled(button);

    await act(async () => {
      button.click();
      await fake.controller.waitForSession();
      fake.controller.emit({ type: "final", text: "alpha" });
    });
    await vi.waitFor(() => expect(changes).toEqual(["alpha"]));

    act(() => commitValue("external"));
    expect(textarea.value).toBe("external");
    act(() => commitValue("alpha"));
    expect(textarea.value).toBe("alpha");
  });

  it("updates uncontrolled fields and dispatches a native input event", async () => {
    const fake = createFakeVoiceInputProvider();
    const inputEvents = vi.fn<() => void>();
    render(
      <VoiceInputProvider
        provider={fake.provider}
        audioSource={createFakeAudioSource()}
      >
        <UncontrolledField initialValue="" onInput={inputEvents} />
      </VoiceInputProvider>,
    );
    const textarea = getTextarea("uncontrolled");
    const button = getButton("uncontrolled trigger");
    await waitForEnabled(button);
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    await act(async () => {
      button.click();
      await fake.controller.waitForSession();
      fake.controller.emit({ type: "final", text: "world" });
      fake.controller.emit({ type: "final", text: "," });
      fake.controller.emit({ type: "final", text: "again" });
      fake.controller.emit({ type: "final", text: "今" });
      fake.controller.emit({ type: "final", text: "天" });
      fake.controller.emit({ type: "final", text: "" });
    });

    await vi.waitFor(() => expect(textarea.value).toBe("world, again 今天"));
    expect(inputEvents).toHaveBeenCalledTimes(5);
  });

  it("composes headless trigger handlers without unsafe spread ordering", async () => {
    const fake = createFakeVoiceInputProvider();
    const onClick = vi.fn<React.MouseEventHandler<HTMLButtonElement>>((event) =>
      event.preventDefault(),
    );
    render(
      <VoiceInputProvider
        provider={fake.provider}
        audioSource={createFakeAudioSource()}
      >
        <ComposedTriggerField onClick={onClick} />
      </VoiceInputProvider>,
    );
    const button = getButton("composed trigger");
    await waitForEnabled(button);

    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    expect(onClick).toHaveBeenCalledOnce();
    expect(fake.controller.sessions).toHaveLength(0);
  });

  it("distinguishes raw final parts from cumulative transcript callbacks", async () => {
    const fake = createFakeVoiceInputProvider();
    const finalParts: string[] = [];
    const finals: string[] = [];
    const changes: string[] = [];
    render(
      <VoiceInputProvider
        provider={fake.provider}
        audioSource={createFakeAudioSource()}
      >
        <CallbackField
          onFinalPart={(text) => finalParts.push(text)}
          onFinal={(text) => finals.push(text)}
          onChange={(text) => changes.push(text)}
        />
      </VoiceInputProvider>,
    );
    const button = getButton("callback trigger");
    await waitForEnabled(button);

    await act(async () => {
      button.click();
      await fake.controller.waitForSession();
      fake.controller.emit({ type: "final", text: "hello" });
      fake.controller.emit({ type: "interim", text: "  wor  " });
      fake.controller.emit({ type: "final", text: "world" });
      fake.controller.emit({ type: "final", text: "," });
      fake.controller.emit({ type: "final", text: "again" });
      fake.controller.emit({ type: "final", text: "" });
      fake.controller.emit({ type: "final", text: "今" });
      fake.controller.emit({ type: "final", text: "天" });
    });

    await vi.waitFor(() => expect(finals).toHaveLength(6));
    expect(finalParts).toEqual([
      "hello",
      "world",
      ",",
      "again",
      "",
      "今",
      "天",
    ]);
    expect(finals).toEqual([
      "hello",
      "hello world",
      "hello world,",
      "hello world, again",
      "hello world, again 今",
      "hello world, again 今天",
    ]);
    expect(changes).toEqual([
      "hello",
      "hello wor",
      "hello world",
      "hello world,",
      "hello world, again",
      "hello world, again 今",
      "hello world, again 今天",
    ]);
    expect(getTextarea("callback").value).toBe("hello world, again 今天");
    expect(getOutput("callback transcript").textContent).toBe(
      "hello world, again 今天",
    );
  });

  it("exposes exact text ownership snapshots", async () => {
    const fake = createFakeVoiceInputProvider();
    const events: VoiceInputSessionEvent[] = [];
    let readSnapshot: (() => VoiceInputTextEngineSnapshot) | undefined;
    render(
      <VoiceInputProvider
        provider={fake.provider}
        audioSource={createFakeAudioSource()}
      >
        <InspectableField
          expose={(read) => (readSnapshot = read)}
          onEvent={(event) => events.push(event)}
        />
      </VoiceInputProvider>,
    );
    const button = getButton("inspectable trigger");
    await waitForEnabled(button);

    await act(async () => {
      button.click();
      await fake.controller.waitForSession();
      fake.controller.emit({ type: "interim", text: "draft" });
      fake.controller.emit({ type: "speech-start" });
      fake.controller.emit({ type: "speech-end" });
    });

    await vi.waitFor(() =>
      expect(readSnapshot?.().spans).toMatchObject([
        { start: 0, end: 5, state: "provisional", text: "draft" },
      ]),
    );
    expect(events).toContainEqual({ type: "speech-start" });
    expect(events).toContainEqual({ type: "speech-end" });
  });

  it("starts and preserves speech on pointer hold release", async () => {
    const fake = createFakeVoiceInputProvider();
    render(
      <VoiceInputProvider
        provider={fake.provider}
        audioSource={createFakeAudioSource()}
      >
        <UncontrolledField activationMode="hold" />
      </VoiceInputProvider>,
    );
    const button = getButton("uncontrolled trigger");
    const textarea = getTextarea("uncontrolled");
    await waitForEnabled(button);
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    await act(async () => {
      button.dispatchEvent(pointerEvent("pointerdown", 7));
      await fake.controller.waitForSession();
    });
    await vi.waitFor(() =>
      expect(button.getAttribute("aria-pressed")).toBe("true"),
    );
    await act(async () => {
      fake.controller.emit({ type: "final", text: "held" });
      button.dispatchEvent(pointerEvent("pointerup", 7));
    });

    await vi.waitFor(() =>
      expect(fake.controller.sessions[0]?.finishCallCount).toBe(1),
    );
    expect(textarea.value).toBe("hello held");
  });

  it("allows only one active session in a provider context", async () => {
    const firstFake = createFakeVoiceInputProvider({
      autoCloseOnFinish: false,
    });
    const secondFake = createFakeVoiceInputProvider();
    const audioSource = createFakeAudioSource();
    render(
      <VoiceInputProvider
        provider={firstFake.provider}
        audioSource={audioSource}
      >
        <UncontrolledField name="first" />
        <UncontrolledField
          name="second"
          provider={secondFake.provider}
          audioSource={audioSource}
        />
      </VoiceInputProvider>,
    );
    const first = getButton("first trigger");
    const second = getButton("second trigger");
    const firstTextarea = getTextarea("first");
    await waitForEnabled(first);
    await waitForEnabled(second);
    firstTextarea.focus();
    firstTextarea.setSelectionRange(
      firstTextarea.value.length,
      firstTextarea.value.length,
    );

    await act(async () => {
      first.click();
      await firstFake.controller.waitForSession();
    });
    await act(async () => {
      second.click();
      await Promise.resolve();
    });

    expect(firstFake.controller.sessions[0]?.finishCallCount).toBe(1);
    expect(secondFake.controller.sessions).toHaveLength(0);
    expect(audioSource.prepareCallCount).toBe(1);

    await act(async () => {
      firstFake.controller.emit({ type: "final", text: "preserved" });
      firstFake.controller.close();
      await secondFake.controller.waitForSession();
    });
    await vi.waitFor(() =>
      expect(first.getAttribute("aria-pressed")).toBe("false"),
    );
    expect(secondFake.controller.sessions).toHaveLength(1);
    expect(second.getAttribute("aria-pressed")).toBe("true");
    expect(audioSource.prepareCallCount).toBe(2);
    expect(firstTextarea.value).toBe("hello preserved");
  });

  it("does not freeze provisional text when a real toggle gesture stops", async () => {
    const fake = createFakeVoiceInputProvider({ autoCloseOnFinish: false });
    render(
      <VoiceInputProvider
        provider={fake.provider}
        audioSource={createFakeAudioSource()}
      >
        <UncontrolledField initialValue="" />
      </VoiceInputProvider>,
    );
    const textarea = getTextarea("uncontrolled");
    const button = getButton("uncontrolled trigger");
    await waitForEnabled(button);
    textarea.focus();
    textarea.setSelectionRange(0, 0);

    await act(async () => {
      button.dispatchEvent(pointerEvent("pointerdown", 1));
      button.click();
      await fake.controller.waitForSession();
      fake.controller.emit({ type: "interim", text: "draft" });
    });
    await vi.waitFor(() => expect(textarea.value).toBe("draft"));

    await act(async () => {
      button.dispatchEvent(pointerEvent("pointerdown", 2));
      button.click();
    });
    await vi.waitFor(() =>
      expect(fake.controller.sessions[0]?.finishCallCount).toBe(1),
    );
    await act(async () => {
      fake.controller.emit({ type: "final", text: "draft" });
      fake.controller.close();
    });

    await vi.waitFor(() => expect(textarea.value).toBe("draft"));
  });

  it("survives StrictMode effect replay with its target attached", async () => {
    const fake = createFakeVoiceInputProvider();
    render(
      <StrictMode>
        <VoiceInputProvider
          provider={fake.provider}
          audioSource={createFakeAudioSource()}
        >
          <UncontrolledField initialValue="" />
        </VoiceInputProvider>
      </StrictMode>,
    );
    const textarea = getTextarea("uncontrolled");
    const button = getButton("uncontrolled trigger");
    await waitForEnabled(button);

    await act(async () => {
      button.click();
      await fake.controller.waitForSession();
      fake.controller.emit({ type: "final", text: "strict" });
    });

    await vi.waitFor(() => expect(textarea.value).toBe("strict"));
  });

  it("honors a hook audio source override inside provider context", async () => {
    const fake = createFakeVoiceInputProvider();
    const contextAudio = createFakeAudioSource();
    const hookAudio = createFakeAudioSource();
    render(
      <VoiceInputProvider provider={fake.provider} audioSource={contextAudio}>
        <UncontrolledField audioSource={hookAudio} />
      </VoiceInputProvider>,
    );
    const button = getButton("uncontrolled trigger");
    await waitForEnabled(button);

    await act(async () => {
      button.click();
      await fake.controller.waitForSession();
    });

    expect(hookAudio.prepareCallCount).toBe(1);
    expect(contextAudio.prepareCallCount).toBe(0);
  });

  it("serializes provider replacement and isolates the old final", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const firstFake = createFakeVoiceInputProvider({
      autoCloseOnFinish: false,
    });
    const secondFake = createFakeVoiceInputProvider();
    render(
      <ReconfigurableField
        firstProvider={firstFake.provider}
        secondProvider={secondFake.provider}
        audioSource={createFakeAudioSource()}
      />,
    );
    const textarea = getTextarea("reconfigured");
    const trigger = getButton("reconfigured trigger");
    await waitForEnabled(trigger);

    await act(async () => {
      trigger.click();
      await firstFake.controller.waitForSession();
    });
    await vi.waitFor(() =>
      expect(trigger.getAttribute("aria-pressed")).toBe("true"),
    );
    await act(async () => {
      getButton("switch provider").click();
    });
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("provider identity changed"),
    );
    await waitForEnabled(trigger);
    await act(async () => {
      trigger.click();
      await Promise.resolve();
    });
    expect(secondFake.controller.sessions).toHaveLength(0);

    await act(async () => {
      firstFake.controller.emit({ type: "final", text: "old" });
      firstFake.controller.close();
      await secondFake.controller.waitForSession();
      secondFake.controller.emit({ type: "final", text: "new" });
    });

    await vi.waitFor(() => expect(textarea.value).toBe("new"));
  });

  it("retains provider-context ownership across a provider change", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const firstFake = createFakeVoiceInputProvider({
      autoCloseOnFinish: false,
    });
    const secondFake = createFakeVoiceInputProvider();
    render(
      <ReconfigurableProviderField
        firstProvider={firstFake.provider}
        secondProvider={secondFake.provider}
        audioSource={createFakeAudioSource()}
      />,
    );
    const textarea = getTextarea("context reconfigured");
    const trigger = getButton("context reconfigured trigger");
    await waitForEnabled(trigger);

    await act(async () => {
      trigger.click();
      await firstFake.controller.waitForSession();
    });
    await vi.waitFor(() =>
      expect(trigger.getAttribute("aria-pressed")).toBe("true"),
    );
    await act(async () => {
      getButton("switch context provider").click();
    });
    await waitForEnabled(trigger);
    await act(async () => {
      trigger.click();
      await Promise.resolve();
    });
    expect(secondFake.controller.sessions).toHaveLength(0);

    await act(async () => {
      firstFake.controller.emit({ type: "final", text: "old" });
      firstFake.controller.close();
      await secondFake.controller.waitForSession();
      secondFake.controller.emit({ type: "final", text: "new" });
    });

    await vi.waitFor(() => expect(textarea.value).toBe("new"));
  });

  it("keeps an inline transcript transform stable across controlled rerenders", async () => {
    const fake = createFakeVoiceInputProvider();
    render(
      <VoiceInputProvider
        provider={fake.provider}
        audioSource={createFakeAudioSource()}
      >
        <InlineTransformField />
      </VoiceInputProvider>,
    );
    const textarea = getTextarea("transform");
    const button = getButton("transform trigger");
    await waitForEnabled(button);

    await act(async () => {
      button.click();
      await fake.controller.waitForSession();
      fake.controller.emit({ type: "interim", text: "hello" });
    });
    await vi.waitFor(() => expect(textarea.value).toBe("hello"));
    expect(fake.controller.sessions[0]?.finishCallCount).toBe(0);

    await act(async () => {
      fake.controller.emit({ type: "final", text: "hello" });
      button.click();
    });
    await vi.waitFor(() => expect(textarea.value).toBe("HELLO"));
  });

  it("stops a held session when the trigger becomes disabled", async () => {
    const fake = createFakeVoiceInputProvider();
    render(
      <VoiceInputProvider
        provider={fake.provider}
        audioSource={createFakeAudioSource()}
      >
        <DisableWhileHeld />
      </VoiceInputProvider>,
    );
    const trigger = getButton("hold trigger");
    const disable = getButton("disable hold");
    await waitForEnabled(trigger);

    await act(async () => {
      trigger.dispatchEvent(pointerEvent("pointerdown", 11));
      await fake.controller.waitForSession();
    });
    await vi.waitFor(() =>
      expect(trigger.getAttribute("aria-pressed")).toBe("true"),
    );
    await act(async () => {
      disable.click();
    });

    await vi.waitFor(() =>
      expect(fake.controller.sessions[0]?.finishCallCount).toBe(1),
    );
    expect(trigger.disabled).toBe(true);
  });

  it("stops a held session when pointer capture is lost", async () => {
    const fake = createFakeVoiceInputProvider();
    render(
      <VoiceInputProvider
        provider={fake.provider}
        audioSource={createFakeAudioSource()}
      >
        <UncontrolledField activationMode="hold" />
      </VoiceInputProvider>,
    );
    const trigger = getButton("uncontrolled trigger");
    await waitForEnabled(trigger);

    await act(async () => {
      trigger.dispatchEvent(pointerEvent("pointerdown", 12));
      await fake.controller.waitForSession();
    });
    await vi.waitFor(() =>
      expect(trigger.getAttribute("aria-pressed")).toBe("true"),
    );
    await act(async () => {
      trigger.dispatchEvent(pointerEvent("lostpointercapture", 12));
    });

    await vi.waitFor(() =>
      expect(fake.controller.sessions[0]?.finishCallCount).toBe(1),
    );
  });

  it("works without context and stops on unmount", async () => {
    const fake = createFakeVoiceInputProvider();
    const root = render(
      <UncontrolledField
        provider={fake.provider}
        audioSource={createFakeAudioSource()}
      />,
    );
    const button = getButton("uncontrolled trigger");
    await waitForEnabled(button);
    await act(async () => {
      button.click();
      await fake.controller.waitForSession();
    });

    await act(async () => {
      root.unmount();
      roots.splice(roots.indexOf(root), 1);
    });

    await vi.waitFor(() =>
      expect(fake.controller.sessions[0]?.finishCallCount).toBe(1),
    );
  });
});

function ComposedTriggerField({
  onClick,
}: {
  readonly onClick: React.MouseEventHandler<HTMLButtonElement>;
}): React.JSX.Element {
  const voice = useVoiceInput();
  return (
    <button
      {...voice.getTriggerProps({
        "aria-label": "composed trigger",
        onClick,
      })}
    >
      Speak
    </button>
  );
}

function ControlledField({
  onStatus,
}: {
  onStatus: (status: string) => void;
}): React.JSX.Element {
  const [value, setValue] = useState("Say old now");
  const voice = useVoiceInput({
    value,
    onValueChange: setValue,
    onStatusChange: onStatus,
  });
  const { targetRef, triggerProps } = voice;
  return (
    <>
      <textarea
        aria-label="controlled"
        ref={targetRef}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <button aria-label="controlled trigger" {...triggerProps}>
        Speak
      </button>
    </>
  );
}

function DeferredControlledField({
  exposeCommit,
  exposeSnapshot,
  onValueChange,
}: {
  exposeCommit: (commit: (value: string) => void) => void;
  exposeSnapshot: (read: () => VoiceInputTextEngineSnapshot) => void;
  onValueChange: (value: string) => void;
}): React.JSX.Element {
  const [value, setValue] = useState("");
  const { getTextSnapshot, targetRef, triggerProps } = useVoiceInput({
    value,
    onValueChange,
  });
  useEffect(() => exposeCommit(setValue), [exposeCommit]);
  useEffect(
    () => exposeSnapshot(getTextSnapshot),
    [exposeSnapshot, getTextSnapshot],
  );
  return (
    <>
      <textarea
        aria-label="deferred controlled"
        ref={targetRef}
        value={value}
        onChange={() => {}}
      />
      <button aria-label="deferred controlled trigger" {...triggerProps}>
        Speak
      </button>
    </>
  );
}

function InspectableField({
  expose,
  onEvent,
}: {
  expose: (readSnapshot: () => VoiceInputTextEngineSnapshot) => void;
  onEvent: (event: VoiceInputSessionEvent) => void;
}): React.JSX.Element {
  const { getTextSnapshot, targetRef, triggerProps } = useVoiceInput({
    onEvent,
  });
  useEffect(() => expose(getTextSnapshot), [expose, getTextSnapshot]);
  return (
    <>
      <textarea aria-label="inspectable" ref={targetRef} />
      <button aria-label="inspectable trigger" {...triggerProps}>
        Speak
      </button>
    </>
  );
}

function CallbackField({
  onFinalPart,
  onFinal,
  onChange,
}: {
  onFinalPart: (text: string) => void;
  onFinal: (text: string) => void;
  onChange: (text: string) => void;
}): React.JSX.Element {
  const [value, setValue] = useState("");
  const { targetRef, triggerProps, transcript } = useVoiceInput({
    value,
    onValueChange: setValue,
    onFinalTranscriptPart: onFinalPart,
    onFinalTranscript: onFinal,
    onTranscriptChange: onChange,
  });
  return (
    <>
      <textarea
        aria-label="callback"
        ref={targetRef}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <button aria-label="callback trigger" {...triggerProps}>
        Speak
      </button>
      <output aria-label="callback transcript">{transcript}</output>
    </>
  );
}

function UncontrolledField({
  name = "uncontrolled",
  initialValue = "hello",
  activationMode,
  onInput,
  provider,
  audioSource,
}: {
  name?: string;
  initialValue?: string;
  activationMode?: VoiceInputActivationMode;
  onInput?: () => void;
  provider?: VoiceInputProviderV1;
  audioSource?: VoiceAudioSource;
}): React.JSX.Element {
  const voice = useVoiceInput({
    ...(activationMode === undefined ? {} : { activationMode }),
    ...(provider === undefined ? {} : { provider }),
    ...(audioSource === undefined ? {} : { audioSource }),
  });
  const { targetRef, triggerProps } = voice;
  return (
    <>
      <textarea
        aria-label={name}
        defaultValue={initialValue}
        ref={targetRef}
        onInput={onInput}
      />
      <button aria-label={`${name} trigger`} {...triggerProps}>
        Speak
      </button>
    </>
  );
}

function InlineTransformField(): React.JSX.Element {
  const [value, setValue] = useState("");
  const { targetRef, triggerProps } = useVoiceInput({
    value,
    onValueChange: setValue,
    transformTranscript: async (transcript) => transcript.toUpperCase(),
  });
  return (
    <>
      <textarea
        aria-label="transform"
        ref={targetRef}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <button aria-label="transform trigger" {...triggerProps}>
        Speak
      </button>
    </>
  );
}

function ReconfigurableField({
  firstProvider,
  secondProvider,
  audioSource,
}: {
  firstProvider: VoiceInputProviderV1;
  secondProvider: VoiceInputProviderV1;
  audioSource: VoiceAudioSource;
}): React.JSX.Element {
  const [provider, setProvider] = useState(firstProvider);
  const [value, setValue] = useState("");
  const { targetRef, triggerProps } = useVoiceInput({
    provider,
    audioSource,
    value,
    onValueChange: setValue,
  });
  return (
    <>
      <textarea
        aria-label="reconfigured"
        ref={targetRef}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <button aria-label="reconfigured trigger" {...triggerProps}>
        Speak
      </button>
      <button
        type="button"
        aria-label="switch provider"
        onClick={() => setProvider(secondProvider)}
      >
        Switch
      </button>
    </>
  );
}

function ReconfigurableProviderField({
  firstProvider,
  secondProvider,
  audioSource,
}: {
  firstProvider: VoiceInputProviderV1;
  secondProvider: VoiceInputProviderV1;
  audioSource: VoiceAudioSource;
}): React.JSX.Element {
  const [provider, setProvider] = useState(firstProvider);
  return (
    <>
      <VoiceInputProvider provider={provider} audioSource={audioSource}>
        <UncontrolledField name="context reconfigured" initialValue="" />
      </VoiceInputProvider>
      <button
        type="button"
        aria-label="switch context provider"
        onClick={() => setProvider(secondProvider)}
      >
        Switch
      </button>
    </>
  );
}

function DisableWhileHeld(): React.JSX.Element {
  const [disabled, setDisabled] = useState(false);
  const { targetRef, triggerProps } = useVoiceInput({
    activationMode: "hold",
    disabled,
  });
  return (
    <>
      <textarea aria-label="hold" ref={targetRef} />
      <button aria-label="hold trigger" {...triggerProps}>
        Hold
      </button>
      <button
        type="button"
        aria-label="disable hold"
        onClick={() => setDisabled(true)}
      >
        Disable
      </button>
    </>
  );
}

interface FakeAudioSource extends VoiceAudioSource {
  prepareCallCount: number;
}

function createFakeAudioSource(): FakeAudioSource {
  const source: FakeAudioSource = {
    prepareCallCount: 0,
    async prepare(): Promise<PreparedVoiceAudioSource> {
      source.prepareCallCount += 1;
      let controller: ReadableStreamDefaultController<Int16Array> | undefined;
      let closed = false;
      const stream = new ReadableStream<Int16Array>({
        start(streamController) {
          controller = streamController;
        },
      });
      const close = (): void => {
        if (!closed) {
          closed = true;
          controller?.close();
        }
      };
      return {
        stream,
        start() {},
        stop: close,
        abort: close,
      };
    },
  };
  return source;
}

function render(children: React.ReactNode): Root {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(children));
  return root;
}

function getTextarea(label: string): HTMLTextAreaElement {
  const element = document.querySelector(`textarea[aria-label="${label}"]`);
  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error(`Textarea ${label} was not rendered.`);
  }
  return element;
}

function getOutput(label: string): HTMLOutputElement {
  const output = document.querySelector<HTMLOutputElement>(
    `output[aria-label="${label}"]`,
  );
  if (output === null) {
    throw new Error(`Missing output: ${label}`);
  }
  return output;
}

function getButton(label: string): HTMLButtonElement {
  const element = document.querySelector(`button[aria-label="${label}"]`);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Button ${label} was not rendered.`);
  }
  return element;
}

function pointerEvent(type: string, pointerId: number): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    button: 0,
    pointerId,
  });
}

async function waitForEnabled(button: HTMLButtonElement): Promise<void> {
  await vi.waitFor(() => expect(button.disabled).toBe(false));
}
