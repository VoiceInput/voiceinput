export const docs = [
  {
    slug: "overview",
    title: "Overview",
    group: "Get started",
    source: "docs/overview.md",
    description:
      "Add dictation to React inputs and textareas. Requirements, supported fields, and how VoiceInput works.",
  },
  {
    slug: "quickstart",
    title: "Quickstart",
    group: "Get started",
    source: "docs/quickstart.md",
    description:
      "Install VoiceInput, create a secure token route, and add dictation to a React field.",
  },
  {
    slug: "golden-paths",
    title: "Example projects",
    group: "Get started",
    source: "docs/golden-paths.md",
    description:
      "Run a simulated demo or start from a full-stack Next.js or Vite example.",
  },
  {
    slug: "nextjs",
    title: "Next.js",
    group: "Guides",
    source: "docs/nextjs.md",
    description:
      "Add VoiceInput to a Next.js App Router application with a server token route and a client field.",
  },
  {
    slug: "vite-hono",
    title: "Vite + Hono",
    group: "Guides",
    source: "docs/vite-hono.md",
    description:
      "Connect a Vite React app to a Hono token API through a development proxy.",
  },
  {
    slug: "express",
    title: "Express",
    group: "Guides",
    source: "docs/express.md",
    description:
      "Bridge an Express request to the Fetch-standard VoiceInput token handler.",
  },
  {
    slug: "form-integration",
    title: "Forms and existing fields",
    group: "Guides",
    source: "docs/form-integration.md",
    description:
      "Add dictation to a custom textarea or React Hook Form without changing its submit flow.",
  },
  {
    slug: "editing-contract",
    title: "Editing and undo",
    group: "Guides",
    source: "docs/editing-contract.md",
    description:
      "Learn how dictation interacts with cursor movement, manual edits, undo, reset, and text limits.",
  },
  {
    slug: "authentication-recipes",
    title: "Authentication and rate limits",
    group: "Guides",
    source: "docs/authentication-recipes.md",
    description:
      "Connect a session library to the token route and add a shared rate limit.",
  },
  {
    slug: "content-security-policy",
    title: "Content Security Policy",
    group: "Guides",
    source: "docs/content-security-policy.md",
    description:
      "Self-host the audio processor and configure provider connections for a strict Content Security Policy.",
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    group: "Guides",
    source: "docs/troubleshooting.md",
    description:
      "Fix microphone permissions, disabled controls, authentication errors, and connection failures.",
  },
  {
    slug: "providers",
    title: "Choose a provider",
    group: "Providers",
    source: "docs/providers.md",
    description:
      "Compare OpenAI, ElevenLabs, and Deepgram and choose an adapter.",
  },
  {
    slug: "providers/openai",
    title: "OpenAI",
    group: "Providers",
    source: "packages/openai/README.md",
    description:
      "Set up OpenAI transcription, temporary credentials, language, and phrase detection.",
  },
  {
    slug: "providers/elevenlabs",
    title: "ElevenLabs",
    group: "Providers",
    source: "packages/elevenlabs/README.md",
    description:
      "Set up ElevenLabs Realtime Scribe with single-use tokens and transcription options.",
  },
  {
    slug: "providers/deepgram",
    title: "Deepgram",
    group: "Providers",
    source: "packages/deepgram/README.md",
    description:
      "Set up Deepgram transcription with temporary tokens, language selection, and formatting.",
  },
  {
    slug: "react",
    title: "React API",
    group: "Reference",
    source: "packages/react/README.md",
    description:
      "Reference for useVoiceInput, controls, shared configuration, and styling.",
  },
  {
    slug: "core",
    title: "Core API",
    group: "Reference",
    source: "packages/core/README.md",
    description:
      "Framework-independent APIs for voice sessions, browser audio, and text editing.",
  },
  {
    slug: "provider",
    title: "Provider contract",
    group: "Reference",
    source: "packages/provider/README.md",
    description:
      "The adapter contract, transcript segments, errors, and provider test utilities.",
  },
  {
    slug: "custom-provider",
    title: "Custom providers",
    group: "Reference",
    source: "docs/custom-provider.md",
    description:
      "Build an adapter with option validation, streaming events, cancellation, and conformance tests.",
  },
  {
    slug: "support-policy",
    title: "Browser and runtime support",
    group: "Reference",
    source: "docs/support-policy.md",
    description:
      "React, Node.js, TypeScript, and browser requirements and tested behavior.",
  },
];

export const groups = [...new Set(docs.map((doc) => doc.group))];
