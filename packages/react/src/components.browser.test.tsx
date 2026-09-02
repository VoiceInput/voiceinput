import {
  VoiceInputError,
  type PreparedVoiceAudioSource,
  type VoiceAudioSource,
} from "@voiceinput/core";
import type { VoiceInputProviderV1 } from "@voiceinput/provider";
import { createFakeVoiceInputProvider } from "@voiceinput/provider/test";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VoiceButton, VoiceInput, VoiceTextarea } from "./index.js";

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
  vi.unstubAllGlobals();
});

describe("React controls", () => {
  it("forwards button props and refs while exposing and announcing state", async () => {
    const fake = createFakeVoiceInputProvider();
    const onClick = vi.fn<React.MouseEventHandler<HTMLButtonElement>>();
    let buttonRef: HTMLButtonElement | null = null;

    render(
      <>
        <p id="voice-hint">Dictate a message</p>
        <VoiceButton
          ref={(node) => {
            buttonRef = node;
          }}
          aria-describedby="voice-hint"
          className="custom-trigger"
          name="voice-trigger"
          voice={{
            provider: fake.provider,
            audioSource: createFakeAudioSource(),
          }}
          onClick={onClick}
        >
          {(voice) => <span>{voice.status}</span>}
        </VoiceButton>
      </>,
    );

    const button = getButton("Start voice input");
    await waitForEnabled(button);
    expect(buttonRef).toBe(button);
    expect(button.name).toBe("voice-trigger");
    expect(button.classList.contains("custom-trigger")).toBe(true);
    expect(button.dataset["voiceinputStatus"]).toBe("idle");
    expect(button.dataset["voiceinputSupported"]).toBe("true");
    expect(button.getAttribute("aria-describedby")).toContain("voice-hint");
    expect(button.textContent).toBe("idle");

    await act(async () => {
      button.click();
      await fake.controller.waitForSession();
    });
    await vi.waitFor(() =>
      expect(button.dataset["voiceinputStatus"]).toBe("listening"),
    );
    expect(onClick).toHaveBeenCalledOnce();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.dataset["voiceinputActive"]).toBe("true");
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "Voice input is listening.",
    );

    await act(async () => {
      fake.controller.fail(
        new VoiceInputError({
          code: "provider-error",
          message: "The provider is unavailable.",
        }),
      );
    });
    await vi.waitFor(() =>
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(
        "Voice input error: The provider is unavailable.",
      ),
    );
    expect(button.dataset["voiceinputError"]).toBe("provider-error");
  });

  it("lets a consumer prevent the component's default trigger action", async () => {
    const fake = createFakeVoiceInputProvider();
    render(
      <VoiceButton
        aria-label="blocked trigger"
        voice={{
          provider: fake.provider,
          audioSource: createFakeAudioSource(),
        }}
        onClick={(event) => event.preventDefault()}
      />,
    );
    const button = getButton("blocked trigger");
    await waitForEnabled(button);

    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    expect(fake.controller.sessions).toHaveLength(0);
  });

  it("keeps VoiceTextarea controlled and forwards native field props", async () => {
    const fake = createFakeVoiceInputProvider();
    let textareaRef: HTMLTextAreaElement | null = null;
    render(
      <ControlledTextarea
        setRef={(node) => (textareaRef = node)}
        provider={fake.provider}
        audioSource={createFakeAudioSource()}
      />,
    );
    const textarea = getTextarea("Message");
    const button = getButton("Start voice input");
    await waitForEnabled(button);
    expect(textareaRef).toBe(textarea);
    expect(textarea.name).toBe("message");
    expect(textarea.rows).toBe(4);
    expect(textarea.placeholder).toBe("Say something");
    textarea.focus();
    textarea.setSelectionRange(4, 7);

    await act(async () => {
      button.dispatchEvent(pointerEvent("pointerdown", 1));
      button.click();
      await fake.controller.waitForSession();
      fake.controller.emit({ type: "final", text: "hello" });
    });

    await vi.waitFor(() => expect(textarea.value).toBe("Say hello now"));
    const container = button.closest(".voiceinput-field");
    expect(container).toBeInstanceOf(HTMLElement);
    expect((container as HTMLElement).dataset["voiceinputStatus"]).toBe(
      "listening",
    );
  });

  it("supports keyboard hold-to-talk in an unstyled VoiceInput", async () => {
    const fake = createFakeVoiceInputProvider();
    const onInput = vi.fn<React.FormEventHandler<HTMLInputElement>>();
    let inputRef: HTMLInputElement | null = null;
    render(
      <VoiceInput
        ref={(node) => {
          inputRef = node;
        }}
        aria-label="Search"
        defaultValue="hello"
        type="search"
        voice={{
          activationMode: "hold",
          provider: fake.provider,
          audioSource: createFakeAudioSource(),
        }}
        voiceButtonProps={{ "aria-label": "Hold to speak", announce: false }}
        onInput={onInput}
      />,
    );
    const input = getInput("Search");
    const button = getButton("Hold to speak");
    await waitForEnabled(button);
    expect(inputRef).toBe(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    await act(async () => {
      button.dispatchEvent(keyboardEvent("keydown", " "));
      await fake.controller.waitForSession();
    });
    await vi.waitFor(() =>
      expect(button.getAttribute("aria-pressed")).toBe("true"),
    );
    await act(async () => {
      fake.controller.emit({ type: "final", text: "world" });
      button.dispatchEvent(keyboardEvent("keyup", " "));
    });

    await vi.waitFor(() => expect(input.value).toBe("hello world"));
    expect(fake.controller.sessions[0]?.finishCallCount).toBe(1);
    expect(onInput).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it("keeps recording across external callback-ref changes and runs their cleanup", async () => {
    const fake = createFakeVoiceInputProvider();
    const audioSource = createFakeAudioSource();
    const firstCleanup = vi.fn<() => void>();
    const secondCleanup = vi.fn<() => void>();
    const firstRef = vi.fn<React.RefCallback<HTMLInputElement>>((node) =>
      node === null ? undefined : firstCleanup,
    );
    const secondRef = vi.fn<React.RefCallback<HTMLInputElement>>((node) =>
      node === null ? undefined : secondCleanup,
    );
    const field = (ref: React.RefCallback<HTMLInputElement>) => (
      <VoiceInput
        ref={ref}
        aria-label="Stable ref field"
        voice={{ provider: fake.provider, audioSource }}
      />
    );
    const root = render(field(firstRef));
    const button = getButton("Start voice input");
    await waitForEnabled(button);

    await act(async () => {
      button.click();
      await fake.controller.waitForSession();
    });
    await act(async () => {
      root.render(field(secondRef));
    });

    expect(firstCleanup).toHaveBeenCalledOnce();
    expect(secondRef).toHaveBeenCalledWith(getInput("Stable ref field"));
    expect(fake.controller.sessions[0]?.finishCallCount).toBe(0);
    expect(button.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      root.unmount();
      roots.splice(roots.indexOf(root), 1);
    });
    expect(secondCleanup).toHaveBeenCalledOnce();
  });

  it("announces when voice input is unsupported", async () => {
    vi.stubGlobal("isSecureContext", false);
    const fake = createFakeVoiceInputProvider();
    render(
      <VoiceButton
        voice={{
          provider: fake.provider,
          audioSource: createFakeAudioSource(),
        }}
      />,
    );

    const button = getButton("Voice input unavailable");
    expect(button.disabled).toBe(true);
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "Voice input is unavailable in this browser.",
    );
  });
});

function ControlledTextarea({
  setRef,
  provider,
  audioSource,
}: {
  readonly setRef: (node: HTMLTextAreaElement | null) => void;
  readonly provider: VoiceInputProviderV1;
  readonly audioSource: VoiceAudioSource;
}): React.JSX.Element {
  const [value, setValue] = useState("Say old now");
  return (
    <VoiceTextarea
      ref={setRef}
      aria-label="Message"
      name="message"
      placeholder="Say something"
      rows={4}
      value={value}
      voice={{ provider, audioSource }}
      voiceButtonProps={{ children: (voice) => voice.status }}
      onChange={(event) => setValue(event.currentTarget.value)}
      onValueChange={setValue}
    />
  );
}

function createFakeAudioSource(): VoiceAudioSource {
  return {
    async prepare(): Promise<PreparedVoiceAudioSource> {
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
      return { stream, start() {}, stop: close, abort: close };
    },
  };
}

function render(children: React.ReactNode): Root {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(children));
  return root;
}

function getButton(label: string): HTMLButtonElement {
  const element = document.querySelector(`button[aria-label="${label}"]`);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Button ${label} was not rendered.`);
  }
  return element;
}

function getInput(label: string): HTMLInputElement {
  const element = document.querySelector(`input[aria-label="${label}"]`);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Input ${label} was not rendered.`);
  }
  return element;
}

function getTextarea(label: string): HTMLTextAreaElement {
  const element = document.querySelector(`textarea[aria-label="${label}"]`);
  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error(`Textarea ${label} was not rendered.`);
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

function keyboardEvent(type: string, key: string): KeyboardEvent {
  return new KeyboardEvent(type, { bubbles: true, key });
}

async function waitForEnabled(button: HTMLButtonElement): Promise<void> {
  await vi.waitFor(() => expect(button.disabled).toBe(false));
}
