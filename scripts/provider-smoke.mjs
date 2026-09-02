import { setTimeout as delay } from "node:timers/promises";
import { readFile } from "node:fs/promises";

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
    const streamResult = collectStream(providerSession.stream).then(
      (parts) => ({ parts }),
      (error) => ({ error }),
    );
    const chunks = await createSpeechPcm(provider.sampleRate);
    for (const chunk of chunks) {
      await providerSession.sendAudio(chunk);
      await delay(20, undefined, { signal: abortController.signal });
    }
    await providerSession.finish();
    const outcome = await streamResult;
    if ("error" in outcome) {
      throw outcome.error;
    }
    const finalTranscript = outcome.parts
      .filter((part) => part.type === "final")
      .map((part) => part.text)
      .join(" ")
      .trim();
    if (finalTranscript.length === 0) {
      throw new Error("Provider returned no committed final transcript.");
    }

    if (!tokenIssued) {
      throw new Error(
        "The server token handler did not report a minted token.",
      );
    }

    abortController.abort("credential-smoke-complete");
    console.log(
      `${smokeCase.name}: token minted, speech streamed, committed final received (${JSON.stringify(finalTranscript)})`,
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

async function createSpeechPcm(sampleRate) {
  const wav = await readFile(
    new URL(
      "../fixtures/audio/librispeech-1272-128104-0014.wav",
      import.meta.url,
    ),
  );
  const source = readPcm16Wav(wav);
  const samples = resamplePcm16(source.samples, source.sampleRate, sampleRate);
  const chunkLength = Math.round(sampleRate / 50);
  const chunks = [];
  for (let offset = 0; offset < samples.length; offset += chunkLength) {
    chunks.push(samples.slice(offset, offset + chunkLength));
  }
  return chunks;
}

function readPcm16Wav(wav) {
  if (
    wav.toString("ascii", 0, 4) !== "RIFF" ||
    wav.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("Speech fixture is not a WAV file.");
  }
  let sampleRate;
  let data;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      if (
        wav.readUInt16LE(start) !== 1 ||
        wav.readUInt16LE(start + 2) !== 1 ||
        wav.readUInt16LE(start + 14) !== 16
      ) {
        throw new Error("Speech fixture must be mono PCM16.");
      }
      sampleRate = wav.readUInt32LE(start + 4);
    } else if (id === "data") {
      data = wav.subarray(start, start + size);
    }
    offset = start + size + (size % 2);
  }
  if (sampleRate === undefined || data === undefined) {
    throw new Error("Speech fixture is missing WAV format or audio data.");
  }
  const samples = new Int16Array(data.length / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = data.readInt16LE(index * 2);
  }
  return { sampleRate, samples };
}

function resamplePcm16(samples, sourceRate, targetRate) {
  if (sourceRate === targetRate) {
    return samples;
  }
  const output = new Int16Array(
    Math.round((samples.length * targetRate) / sourceRate),
  );
  for (let index = 0; index < output.length; index += 1) {
    const position = (index * sourceRate) / targetRate;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    const weight = position - left;
    output[index] = Math.round(
      (samples[left] ?? 0) * (1 - weight) + (samples[right] ?? 0) * weight,
    );
  }
  return output;
}

async function collectStream(stream) {
  const parts = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        return parts;
      }
      if (result.value.type === "error") {
        throw result.value.error;
      }
      parts.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
}

function safeErrorMessage(error) {
  if (error !== null && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "Unknown provider failure.";
}
