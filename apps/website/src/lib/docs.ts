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
      "Install VoiceInput with npm or pnpm, create a secure token route, and add dictation to a React field.",
  },
  {
    slug: "golden-paths",
    title: "Example projects",
    group: "Get started",
    source: "docs/golden-paths.md",
    description:
      "Run a simulated demo or start from a Next.js or Vite example with authentication and rate limits.",
  },
  {
    slug: "nextjs",
    title: "Next.js",
    group: "Integrations",
    source: "docs/nextjs.md",
    description:
      "Add VoiceInput to a Next.js App Router application with a server token route and a client-side field.",
  },
  {
    slug: "vite-hono",
    title: "Vite + Hono",
    group: "Integrations",
    source: "docs/vite-hono.md",
    description:
      "Connect a Vite React app to a Hono token API, with setup commands and a development proxy.",
  },
  {
    slug: "express",
    title: "Express",
    group: "Integrations",
    source: "docs/express.md",
    description:
      "Use an existing Express server to authenticate requests and issue temporary voice credentials.",
  },
  {
    slug: "form-integration",
    title: "Existing fields and forms",
    group: "Integrations",
    source: "docs/form-integration.md",
    description:
      "Add dictation to a custom textarea or React Hook Form without changing your form's submit flow.",
  },
  {
    slug: "providers",
    title: "Choose a provider",
    group: "Providers",
    source: "docs/providers.md",
    description:
      "Choose OpenAI, ElevenLabs, or Deepgram and understand which configuration changes between providers.",
  },
  {
    slug: "providers/openai",
    title: "OpenAI",
    group: "Providers",
    source: "packages/openai/README.md",
    description:
      "Set up OpenAI transcription, create temporary credentials, and configure language and phrase detection.",
  },
  {
    slug: "providers/elevenlabs",
    title: "ElevenLabs",
    group: "Providers",
    source: "packages/elevenlabs/README.md",
    description:
      "Set up ElevenLabs Realtime Scribe with single-use tokens and configure transcription options.",
  },
  {
    slug: "providers/deepgram",
    title: "Deepgram",
    group: "Providers",
    source: "packages/deepgram/README.md",
    description:
      "Set up Deepgram transcription with temporary tokens, language selection, and formatting options.",
  },
  {
    slug: "editing-contract",
    title: "Editing and undo",
    group: "Common tasks",
    source: "docs/editing-contract.md",
    description:
      "Learn how dictation interacts with cursor movement, manual edits, undo, reset, and text limits.",
  },
  {
    slug: "authentication-recipes",
    title: "Authentication and rate limits",
    group: "Common tasks",
    source: "docs/authentication-recipes.md",
    description:
      "Connect Clerk, Auth.js, Supabase, or Better Auth to your token route and add shared rate limits.",
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    group: "Common tasks",
    source: "docs/troubleshooting.md",
    description:
      "Fix microphone permissions, disabled controls, authentication errors, and transcription connection failures.",
  },
  {
    slug: "react",
    title: "React API",
    group: "Reference",
    source: "packages/react/README.md",
    description:
      "Reference for useVoiceInput, its options and results, optional controls, shared configuration, and styling.",
  },
  {
    slug: "core",
    title: "Core API",
    group: "Advanced",
    source: "packages/core/README.md",
    description:
      "Framework-independent APIs for voice sessions, browser audio, text insertion, and editing history.",
  },
  {
    slug: "provider",
    title: "Provider contract",
    group: "Advanced",
    source: "packages/provider/README.md",
    description:
      "The streaming adapter contract, transcript segments, error codes, and provider test utilities.",
  },
  {
    slug: "custom-provider",
    title: "Custom providers",
    group: "Advanced",
    source: "docs/custom-provider.md",
    description:
      "Build a transcription adapter with option validation, streaming events, cancellation, and conformance tests.",
  },
  {
    slug: "content-security-policy",
    title: "Content security policy",
    group: "Advanced",
    source: "docs/content-security-policy.md",
    description:
      "Self-host the audio processor and configure provider connections for a strict Content Security Policy.",
  },
  {
    slug: "support-policy",
    title: "Browser and runtime support",
    group: "Project",
    source: "docs/support-policy.md",
    description:
      "React, Node.js, TypeScript, and browser requirements, with the verified scope of the desktop beta.",
  },
];
export const groups = [...new Set(docs.map((doc) => doc.group))];
