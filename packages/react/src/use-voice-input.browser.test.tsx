import type {
  PreparedVoiceAudioSource,
  VoiceAudioSource,
} from "@voiceinput/core";
import { createFakeVoiceInputProvider } from "@voiceinput/provider/test";
import type { VoiceInputProviderV1 } from "@voiceinput/provider";
import { act, StrictMode, useState } from "react";
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
    });
    await vi.waitFor(() => expect(textarea.value).toBe("Say hello now"));

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

  it("updates uncontrolled fields and dispatches a native input event", async () => {
    const fake = createFakeVoiceInputProvider();
    const inputEvents = vi.fn<() => void>();
    render(
      <VoiceInputProvider
        provider={fake.provider}
        audioSource={createFakeAudioSource()}
      >
        <UncontrolledField onInput={inputEvents} />
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
    });

    await vi.waitFor(() => expect(textarea.value).toBe("hello world"));
    expect(inputEvents).toHaveBeenCalledOnce();
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
    await waitForEnabled(first);
    await waitForEnabled(second);

    await act(async () => {
      first.click();
      await firstFake.controller.waitForSession();
    });
    await act(async () => {
      second.click();
      await secondFake.controller.waitForSession();
    });

    expect(firstFake.controller.sessions[0]?.finishCallCount).toBe(1);
    expect(secondFake.controller.sessions).toHaveLength(1);
    expect(second.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      firstFake.controller.close();
    });
    await vi.waitFor(() =>
      expect(first.getAttribute("aria-pressed")).toBe("false"),
    );
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

  it("isolates a replacement provider from delayed events on the old session", async () => {
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
      getButton("switch provider").click();
    });
    await waitForEnabled(trigger);
    await act(async () => {
      trigger.click();
      await secondFake.controller.waitForSession();
      secondFake.controller.emit({ type: "final", text: "new" });
    });
    await vi.waitFor(() => expect(textarea.value).toBe("new"));

    await act(async () => {
      firstFake.controller.emit({ type: "final", text: "old" });
      firstFake.controller.close();
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
