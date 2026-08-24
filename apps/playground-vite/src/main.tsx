import "@voiceinput/playground-shared/styles.css";

import { VoiceInputLab } from "@voiceinput/playground-shared";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("The Vite playground root is missing.");
}

createRoot(root).render(
  <StrictMode>
    <VoiceInputLab runtime="Vite + Hono" />
  </StrictMode>,
);
