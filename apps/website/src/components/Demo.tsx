import { useEffect, useMemo, useState } from "react";
import { useVoiceInput } from "@voiceinput/react";
import { createSimulation, simulatedAudio } from "../lib/simulation";
const initial = "A good idea starts here. ";
export default function Demo() {
  const [value, setValue] = useState(initial);

  const provider = useMemo(() => createSimulation(), []);
  const { targetRef, getTriggerProps, status, error, undo, stop, isSupported } =
    useVoiceInput({
      provider,
      audioSource: simulatedAudio,
      value,
      onValueChange: setValue,
    });
  const running = status !== "idle" && status !== "error";
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("voiceinput-demo", { detail: running }),
    );
    if (!running) return;
    const timer = setTimeout(() => {
      void stop();
    }, 6500);
    return () => {
      clearTimeout(timer);
      window.dispatchEvent(
        new CustomEvent("voiceinput-demo", { detail: false }),
      );
    };
  }, [running, stop]);
  return (
    <div className="demo-composer">
      <div className="composer-heading">
        <span className="composer-dot" />
        Your next great idea
        <span className="simulation-label">Simulated speech</span>
      </div>
      <label className="sr-only" htmlFor="voice-demo">
        Try voice input
      </label>
      <textarea
        id="voice-demo"
        readOnly={!isSupported}
        ref={targetRef}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        spellCheck={false}
      />
      <div className="composer-bottom">
        <div className="demo-tools">
          <button
            type="button"
            onClick={() => undo()}
            aria-label="Undo last edit"
          >
            ↶ <span>Undo</span>
          </button>
          <button
            type="button"
            disabled={running}
            onClick={() => setValue(initial)}
          >
            Reset
          </button>
        </div>
        <button
          className={`speak-button ${running ? "speaking" : ""}`}
          {...getTriggerProps()}
        >
          <svg
            viewBox="0 0 20 20"
            width="18"
            height="18"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M10 2a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M4 9v1a6 6 0 0 0 12 0V9M10 16v3M7 19h6"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
          {running ? "Stop demo" : "Start demo"}
        </button>
      </div>
      <output className="demo-status">
        {error
          ? error.message
          : running
            ? "Inserting sample speech. Move the cursor or edit along."
            : "No microphone. No API key. Just a feel for the flow."}
      </output>
    </div>
  );
}
