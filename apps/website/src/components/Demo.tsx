import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useVoiceInput } from "@voiceinput/react";
import { getDemoErrorMessage, liveDemo } from "../lib/live-demo";
import {
  DEMO_SECONDS,
  DEMO_CLIENT_FINALIZATION_TIMEOUT_MS,
} from "../lib/demo-config";

type InterimBehavior = "inline" | "expose";
type Health = "ready" | "error" | "unsupported";

const listeningText: Record<InterimBehavior, string> = {
  inline: "Speak naturally. Text appears as you speak.",
  expose: "Speak naturally. Text appears as each phrase is finalized.",
};
const idleText = "Record up to 20 seconds.";

const subscribeToHydration = () => () => {};
const getHydratedSnapshot = () => true;
const getServerHydratedSnapshot = () => false;

export default function Demo() {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    getHydratedSnapshot,
    getServerHydratedSnapshot,
  );
  const [interimBehavior, setInterimBehavior] =
    useState<InterimBehavior>("inline");
  const [health, setHealth] = useState<Health>("unsupported");
  const dotState = !hydrated
    ? ""
    : health === "error"
      ? " failed"
      : health === "ready"
        ? " ready"
        : "";
  return (
    <div className="demo-composer">
      <Composer
        hydrated={hydrated}
        interimBehavior={interimBehavior}
        onInterimBehaviorChange={setInterimBehavior}
        dotState={dotState}
        onHealthChange={setHealth}
      />
    </div>
  );
}

function Composer({
  hydrated,
  interimBehavior,
  onInterimBehaviorChange,
  dotState,
  onHealthChange,
}: {
  hydrated: boolean;
  interimBehavior: InterimBehavior;
  onInterimBehaviorChange: (behavior: InterimBehavior) => void;
  dotState: string;
  onHealthChange: (health: Health) => void;
}) {
  const [value, setValue] = useState("");
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
    useVoiceInput({
      provider,
      value,
      onValueChange: setValue,
      disabled: !hydrated,
      interimBehavior,
      finalizationTimeoutMs: DEMO_CLIENT_FINALIZATION_TIMEOUT_MS,
    });
  const running = status !== "idle" && status !== "error";
  const finishing = status === "processing" || status === "stopping";
  useEffect(() => {
    onHealthChange(error ? "error" : isSupported ? "ready" : "unsupported");
  }, [error, isSupported, onHealthChange]);
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
        '[role="menuitem"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)',
      );
      if (items?.length) items[last ? items.length - 1 : 0]?.focus();
    });
  };
  const announce = (message: string) => {
    clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = setTimeout(() => setNotice(""), 2200);
  };
  const statusText = !hydrated
    ? "Initializing the interactive demo…"
    : !isSupported
      ? "Voice input needs a supported browser and a secure connection. You can still type."
      : error
        ? getDemoErrorMessage(error)
        : status === "requesting-permission"
          ? "Allow microphone access in your browser to start dictating."
          : status === "connecting"
            ? "Connecting to transcription…"
            : status === "listening"
              ? listeningText[interimBehavior]
              : finishing
                ? "Finishing your transcript…"
                : notice || idleText;
  return (
    <>
      <div className="composer-editor" data-recording={status === "listening"}>
        <label className="sr-only" htmlFor="voice-demo">
          Try voice input
        </label>
        <textarea
          id="voice-demo"
          ref={attachField}
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          readOnly={!hydrated}
          placeholder="Speak or type…"
          spellCheck={false}
          aria-describedby="demo-status"
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
              aria-controls="writing-options"
              disabled={running || !hydrated}
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
              id="writing-options"
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
                    '[role="menuitem"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)',
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
                role="menuitemcheckbox"
                tabIndex={-1}
                aria-checked={interimBehavior === "expose"}
                onClick={() => {
                  onInterimBehaviorChange(
                    interimBehavior === "expose" ? "inline" : "expose",
                  );
                  closeMenu();
                }}
              >
                <Icon name="final" />
                Show final text only
              </button>
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
                  setValue("");
                  closeMenu();
                  setNotice("");
                  requestAnimationFrame(() => {
                    field.current?.focus();
                    field.current?.setSelectionRange(0, 0);
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
              ) : !hydrated ? (
                "Initializing…"
              ) : null}
            </span>
            <button
              className={`speak-button ${running ? "speaking" : ""}${
                status === "listening" ? " listening" : ""
              }`}
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
        id="demo-status"
        className="demo-status"
        role={error ? "alert" : "status"}
        aria-live={error ? "assertive" : "polite"}
      >
        <span className={`composer-dot${dotState}`} aria-hidden="true" />
        <span className="demo-live-label">Live demo</span>
        <span aria-hidden="true">·</span>
        <span>{statusText}</span>
      </output>
    </>
  );
}

function Icon({
  name,
}: {
  name: "final" | "more" | "copy" | "undo" | "restart" | "mic" | "stop";
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
      {name === "final" ? (
        <path d="m5 12 4 4L19 6" />
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
