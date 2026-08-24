import { setTimeout as delay } from "node:timers/promises";

import { deepgram } from "../packages/deepgram/dist/index.js";
import { createDeepgramTokenHandler } from "../packages/deepgram/dist/server.js";
import { elevenlabs } from "../packages/elevenlabs/dist/index.js";
import { createElevenLabsTokenHandler } from "../packages/elevenlabs/dist/server.js";
import { openai } from "../packages/openai/dist/index.js";
import { createOpenAITokenHandler } from "../packages/openai/dist/server.js";

const requestedProvider = readRequestedProvider(process.argv.slice(2));
const smokeCases = [
  {
    name: "openai",
    environmentName: "OPENAI_API_KEY",
    create(apiKey, onTokenIssued) {
      const handler = createOpenAITokenHandler({
        apiKey,
        authorize: () => ({ subject: "credential-smoke" }),
        onTokenIssued,
      });
      return openai({
        tokenEndpoint: "https://voiceinput.invalid/openai",
        fetch: createHandlerFetch(handler),
      });
    },
  },
  {
    name: "elevenlabs",
    environmentName: "ELEVENLABS_API_KEY",
    create(apiKey, onTokenIssued) {
      const handler = createElevenLabsTokenHandler({
        apiKey,
        authorize: () => ({ subject: "credential-smoke" }),
        onTokenIssued,
      });
      return elevenlabs({
        tokenEndpoint: "https://voiceinput.invalid/elevenlabs",
        fetch: createHandlerFetch(handler),
      });
    },
  },
  {
    name: "deepgram",
    environmentName: "DEEPGRAM_API_KEY",
    create(apiKey, onTokenIssued) {
      const handler = createDeepgramTokenHandler({
        apiKey,
        authorize: () => ({ subject: "credential-smoke" }),
        onTokenIssued,
      });
      return deepgram({
        tokenEndpoint: "https://voiceinput.invalid/deepgram",
        fetch: createHandlerFetch(handler),
      });
    },
  },
].filter(
  ({ name }) => requestedProvider === undefined || name === requestedProvider,
);

for (const smokeCase of smokeCases) {
  await runSmokeCase(smokeCase);
}

function readRequestedProvider(arguments_) {
  const providerArgument = arguments_.find((value) =>
    value.startsWith("--provider="),
  );
  if (providerArgument === undefined) {
    return undefined;
  }
  const provider = providerArgument.slice("--provider=".length);
  if (!["openai", "elevenlabs", "deepgram"].includes(provider)) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return provider;
}

async function runSmokeCase(smokeCase) {
  const apiKey = process.env[smokeCase.environmentName];
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error(`${smokeCase.environmentName} is required.`);
  }

  let tokenIssued = false;
  const provider = smokeCase.create(apiKey, () => {
    tokenIssued = true;
  });
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(new Error("Credential smoke timed out.")),
    30_000,
  );
  let providerSession;

  try {
    providerSession = await provider.doOpen({
      abortSignal: abortController.signal,
      language: "en-US",
    });
    const streamFailure = monitorStream(providerSession.stream).catch(
      (error) => error,
    );
    const chunks = createDeterministicPcm(provider.sampleRate);
    for (const chunk of chunks) {
      await runWhileStreamHealthy(streamFailure, async () => {
        await providerSession.sendAudio(chunk);
        await delay(20, undefined, { signal: abortController.signal });
      });
    }
    await runWhileStreamHealthy(streamFailure, () =>
      delay(250, undefined, { signal: abortController.signal }),
    );

    if (!tokenIssued) {
      throw new Error(
        "The server token handler did not report a minted token.",
      );
    }

    providerSession.abort("credential-smoke-complete");
    abortController.abort("credential-smoke-complete");
    await Promise.race([streamFailure, delay(1_000)]);
    console.log(
      `${smokeCase.name}: token minted, WebSocket opened, PCM streamed`,
    );
  } catch (error) {
    providerSession?.abort("credential-smoke-failed");
    throw new Error(
      `${smokeCase.name} smoke failed: ${safeErrorMessage(error)}`,
    );
  } finally {
    clearTimeout(timeout);
    abortController.abort("credential-smoke-cleanup");
  }
}

function createHandlerFetch(handler) {
  return async (input, init) => {
    const source = new Request(input, init);
    const request = new Request("https://voiceinput.invalid/token", {
      method: source.method,
      headers: source.headers,
      body: source.body,
      duplex: source.body === null ? undefined : "half",
      signal: source.signal,
    });
    return await handler(request);
  };
}

function createDeterministicPcm(sampleRate) {
  const chunkLength = Math.round(sampleRate / 50);
  return Array.from({ length: 25 }, (_, chunkIndex) => {
    const chunk = new Int16Array(chunkLength);
    for (let index = 0; index < chunk.length; index += 1) {
      const sampleIndex = chunkIndex * chunkLength + index;
      chunk[index] = Math.round(
        Math.sin((2 * Math.PI * 440 * sampleIndex) / sampleRate) * 3_000,
      );
    }
    return chunk;
  });
}

async function monitorStream(stream) {
  const reader = stream.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        throw new Error("Provider stream closed before the smoke completed.");
      }
      if (result.value.type === "error") {
        throw result.value.error;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function runWhileStreamHealthy(streamFailure, operation) {
  const outcome = await Promise.race([
    Promise.resolve()
      .then(operation)
      .then(() => ({ type: "operation-complete" })),
    streamFailure.then((error) => ({ type: "stream-failure", error })),
  ]);
  if (outcome.type === "stream-failure") {
    throw outcome.error;
  }
}

function safeErrorMessage(error) {
  if (error !== null && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "Unknown provider failure.";
}
