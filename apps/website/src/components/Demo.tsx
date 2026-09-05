import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVoiceInput } from "@voiceinput/react";
import { liveDemo } from "../lib/live-demo";
import { DEMO_SECONDS } from "../lib/demo-config";

const scenarios = [
  {
    id: "message",
    label: "Message",
    initial: "",
    placeholder: "Write a quick update to your team…",
    hint: "Try saying: “I’ve reviewed the designs. Let’s catch up tomorrow.”",
  },
  {
    id: "note",
    label: "Note",
    initial: "Website review\n\nKeep the first release focused.\nNext steps: ",
    placeholder: "Capture a thought before it slips away…",
    hint: "Add your next steps, or click anywhere to fill in a detail.",
  },
] as const;

export default function Demo() {
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  return (
    <div className="demo-composer">
      <div className="composer-heading">
        <div
          className="demo-tabs"
          role="tablist"
          aria-label="Try a writing example"
        >
          {scenarios.map((scenario, index) => (
            <button
              key={scenario.id}
              ref={(node) => {
                tabs.current[index] = node;
              }}
              id={`demo-tab-${scenario.id}`}
              type="button"
              role="tab"
              aria-selected={active === index}
              aria-controls={`demo-panel-${scenario.id}`}
              tabIndex={active === index ? 0 : -1}
              disabled={busy}
              onClick={() => setActive(index)}
              onKeyDown={(event) => {
                if (busy) return;
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? 1
                      : event.key === "ArrowRight" || event.key === "ArrowLeft"
                        ? 1 - index
                        : null;
                if (next === null) return;
                event.preventDefault();
                setActive(next);
                tabs.current[next]?.focus();
              }}
            >
              <Icon name={scenario.id} />
              {scenario.label}
            </button>
          ))}
        </div>
        <span className="live-label">
          <span className="composer-dot" />
          Live demo
        </span>
      </div>
      {scenarios.map((scenario, index) => (
        <Composer
          key={scenario.id}
          scenario={scenario}
          active={active === index}
          onBusyChange={setBusy}
        />
      ))}
    </div>
  );
}

function Composer({
  scenario,
  active,
  onBusyChange,
}: {
  scenario: (typeof scenarios)[number];
  active: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [value, setValue] = useState<string>(scenario.initial);
  const [seconds, setSeconds] = useState(DEMO_SECONDS);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const field = useRef<HTMLTextAreaElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const menuButton = useRef<HTMLButtonElement | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const { provider, events } = useMemo(() => {
    const events = new EventTarget();
    return {
      events,
      provider: liveDemo(() => events.dispatchEvent(new Event("stop"))),
    };
  }, []);
  const { targetRef, getTriggerProps, status, error, undo, stop, isSupported } =
    useVoiceInput({ provider, value, onValueChange: setValue });
  const running = status !== "idle" && status !== "error";
  const finishing = status === "processing" || status === "stopping";
  useEffect(() => {
    if (active) onBusyChange(running);
  }, [active, running, onBusyChange]);
  useEffect(() => {
    const onStop = () => {
      void stop();
    };
    events.addEventListener("stop", onStop);
    return () => events.removeEventListener("stop", onStop);
  }, [events, stop]);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  const attachField = useCallback(
    (node: HTMLTextAreaElement | null) => {
      field.current = node;
      if (node) node.setSelectionRange(node.value.length, node.value.length);
      return targetRef(node);
    },
    [targetRef],
  );
  useEffect(() => {
    if (status !== "listening") return;
    const started = Date.now();
    const timer = setInterval(() => {
      const remaining = Math.max(
        0,
        DEMO_SECONDS - Math.floor((Date.now() - started) / 1000),
      );
      setSeconds(remaining);
      if (remaining === 0) void stop();
    }, 250);
    return () => clearInterval(timer);
  }, [status, stop]);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target))
        setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);
  const closeMenu = () => {
    setMenuOpen(false);
    menuButton.current?.focus();
  };
  const openMenu = (last = false) => {
    setMenuOpen(true);
    requestAnimationFrame(() => {
      const items = menu.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      );
      if (items?.length) items[last ? items.length - 1 : 0]?.focus();
    });
  };
  const announce = (message: string) => {
    clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = setTimeout(() => setNotice(""), 2200);
  };
  const statusText = !isSupported
    ? "Voice input needs a supported browser and a secure connection. You can still type."
    : error
      ? error.message
      : status === "requesting-permission"
        ? "Allow microphone access in your browser to start dictating."
        : status === "connecting"
          ? "Connecting to transcription…"
          : status === "listening"
            ? "Speak naturally. You can keep typing as you go."
            : finishing
              ? "Finishing your transcript…"
              : notice || scenario.hint;
  return (
    <div
      id={`demo-panel-${scenario.id}`}
      role="tabpanel"
      aria-labelledby={`demo-tab-${scenario.id}`}
      hidden={!active}
    >
      <div className="composer-editor" data-recording={status === "listening"}>
        <label className="sr-only" htmlFor={`voice-demo-${scenario.id}`}>
          Try voice input
        </label>
        <textarea
          id={`voice-demo-${scenario.id}`}
          ref={attachField}
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          placeholder={scenario.placeholder}
          spellCheck={false}
          aria-describedby={`demo-status-${scenario.id}`}
        />
        <div className="composer-bottom">
          <div className="composer-menu" ref={menu}>
            <button
              type="button"
              ref={menuButton}
              className="icon-button"
              aria-label="Writing options"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={`writing-options-${scenario.id}`}
              disabled={running}
              onClick={() => (menuOpen ? closeMenu() : openMenu())}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  openMenu(event.key === "ArrowUp");
                }
              }}
            >
              <Icon name="more" />
            </button>
            <div
              id={`writing-options-${scenario.id}`}
              className="writing-options"
              role="menu"
              tabIndex={-1}
              aria-label="Writing options"
              hidden={!menuOpen}
              onKeyDown={(event) => {
                if (event.key === "Tab") {
                  closeMenu();
                  return;
                }
                const items = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    '[role="menuitem"]:not(:disabled)',
                  ),
                );
                const index = items.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? items.length - 1
                      : event.key === "ArrowDown"
                        ? (index + 1) % items.length
                        : event.key === "ArrowUp"
                          ? (index - 1 + items.length) % items.length
                          : null;
                if (next !== null) {
                  event.preventDefault();
                  items[next]?.focus();
                }
              }}
            >
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={!value}
                onClick={async () => {
                  closeMenu();
                  try {
                    await navigator.clipboard.writeText(value);
                    announce("Text copied.");
                  } catch {
                    field.current?.focus();
                    field.current?.select();
                    announce("Select the text and copy it with your keyboard.");
                  }
                }}
              >
                <Icon name="copy" />
                Copy text
              </button>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  undo();
                  closeMenu();
                }}
              >
                <Icon name="undo" />
                Undo last edit
              </button>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  setValue(scenario.initial);
                  closeMenu();
                  setNotice("");
                  requestAnimationFrame(() => {
                    field.current?.focus();
                    field.current?.setSelectionRange(
                      scenario.initial.length,
                      scenario.initial.length,
                    );
                  });
                }}
              >
                <Icon name="restart" />
                Start over
              </button>
            </div>
          </div>
          <div className="recording-controls">
            <span className="recording-label" aria-hidden="true">
              {status === "listening" ? (
                <>
                  <span className="composer-dot active" />
                  Listening <span className="recording-time">{seconds}s</span>
                </>
              ) : status === "requesting-permission" ? (
                "Allow microphone"
              ) : finishing ? (
                "Finishing…"
              ) : running ? (
                "Connecting…"
              ) : (
                "Type or speak"
              )}
            </span>
            <button
              className={`speak-button ${running ? "speaking" : ""}`}
              {...getTriggerProps({
                onClick: () => {
                  if (!running) {
                    setSeconds(DEMO_SECONDS);
                    setNotice("");
                  }
                },
              })}
            >
              <span className="voice-button-icon" aria-hidden="true">
                <span className={running ? "icon-state" : "icon-state visible"}>
                  <Icon name="mic" />
                </span>
                <span className={running ? "icon-state visible" : "icon-state"}>
                  <Icon name="stop" />
                </span>
              </span>
              {running ? "Stop recording" : "Start recording"}
            </button>
          </div>
        </div>
      </div>
      <output
        id={`demo-status-${scenario.id}`}
        className="demo-status"
        role={error ? "alert" : "status"}
        aria-live={error ? "assertive" : "polite"}
      >
        {statusText}
      </output>
    </div>
  );
}

function Icon({
  name,
}: {
  name:
    "message" | "note" | "more" | "copy" | "undo" | "restart" | "mic" | "stop";
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "message" ? (
        <path d="M20 11.5a8 8 0 0 1-8 8H4l1.5-4A8 8 0 1 1 20 11.5Z" />
      ) : name === "note" ? (
        <>
          <path d="M14 3H5v18h14V8Z" />
          <path d="M14 3v5h5M8 12h8M8 16h6" />
        </>
      ) : name === "more" ? (
        <>
          <circle cx="5" cy="12" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
        </>
      ) : name === "copy" ? (
        <>
          <rect x="8" y="8" width="12" height="13" rx="2" />
          <path d="M16 8V3H3v13h5" />
        </>
      ) : name === "undo" ? (
        <path d="m8 4-5 5 5 5M3 9h10a6 6 0 0 1 0 12" />
      ) : name === "restart" ? (
        <path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" />
      ) : name === "mic" ? (
        <>
          <rect x="9" y="3" width="6" height="12" rx="3" />
          <path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3M9 21h6" />
        </>
      ) : (
        <rect
          x="6"
          y="6"
          width="12"
          height="12"
          rx="2"
          fill="currentColor"
          stroke="none"
        />
      )}
    </svg>
  );
}
