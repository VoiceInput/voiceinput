import { setTimeout as delay } from "node:timers/promises";
import { readFile } from "node:fs/promises";

import { deepgram } from "../packages/deepgram/dist/index.js";
import { createDeepgramTokenHandler } from "../packages/deepgram/dist/server.js";
import { elevenlabs } from "../packages/elevenlabs/dist/index.js";
import { createElevenLabsTokenHandler } from "../packages/elevenlabs/dist/server.js";
import { openai } from "../packages/openai/dist/index.js";
import { createOpenAITokenHandler } from "../packages/openai/dist/server.js";
import { readRunOptions, wordErrorRate } from "./provider-smoke-support.mjs";

const runOptions = readRunOptions(process.argv.slice(2));
const smokeCases = [
  {
    name: "openai",
    defaultEndpointing: 500,
    environmentName: "OPENAI_API_KEY",
    create(apiKey, onTokenIssued, options) {
      const handler = createOpenAITokenHandler({
        apiKey,
        authorize: () => ({ subject: "credential-smoke" }),
        onTokenIssued,
        ...(options.model === undefined
          ? {}
          : { model: options.model, allowedModels: [options.model] }),
      });
      return openai({
        tokenEndpoint: "https://voiceinput.invalid/openai",
        fetch: createHandlerFetch(handler),
        ...(options.model === undefined ? {} : { model: options.model }),
      });
    },
  },
  {
    name: "elevenlabs",
    defaultEndpointing: 650,
    environmentName: "ELEVENLABS_API_KEY",
    create(apiKey, onTokenIssued, options) {
      const handler = createElevenLabsTokenHandler({
        apiKey,
        authorize: () => ({ subject: "credential-smoke" }),
        onTokenIssued,
        ...(options.model === undefined
          ? {}
          : { model: options.model, allowedModels: [options.model] }),
      });
      return elevenlabs({
        tokenEndpoint: "https://voiceinput.invalid/elevenlabs",
        fetch: createHandlerFetch(handler),
        ...(options.model === undefined ? {} : { model: options.model }),
      });
    },
  },
  {
    name: "deepgram",
    defaultEndpointing: "provider-default",
    environmentName: "DEEPGRAM_API_KEY",
    create(apiKey, onTokenIssued, options) {
      const handler = createDeepgramTokenHandler({
        apiKey,
        authorize: () => ({ subject: "credential-smoke" }),
        onTokenIssued,
        ...(options.model === undefined
          ? {}
          : { model: options.model, allowedModels: [options.model] }),
      });
      return deepgram({
        tokenEndpoint: "https://voiceinput.invalid/deepgram",
        fetch: createHandlerFetch(handler),
        ...(options.model === undefined ? {} : { model: options.model }),
      });
    },
  },
].filter(
  ({ name }) =>
    runOptions.provider === undefined || name === runOptions.provider,
);

for (const smokeCase of smokeCases) {
  await runSmokeCase(smokeCase, runOptions);
}

async function runSmokeCase(smokeCase, options) {
  const apiKey = process.env[smokeCase.environmentName];
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error(`${smokeCase.environmentName} is required.`);
  }

  let tokenMetadata;
  const provider = smokeCase.create(
    apiKey,
    (metadata) => {
      tokenMetadata = metadata;
    },
    options,
  );
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(new Error("Credential smoke timed out.")),
    30_000,
  );
  let providerSession;

  try {
    const connectionStartedAt = performance.now();
    providerSession = await provider.doOpen({
      abortSignal: abortController.signal,
      ...(options.language === undefined ? {} : { language: options.language }),
      ...(options.vocabulary.length === 0
        ? {}
        : { vocabulary: options.vocabulary }),
      ...(options.endpointing === undefined
        ? {}
        : { endpointing: options.endpointing }),
    });
    const connectedAt = performance.now();
    const streamResult = collectStream(providerSession.stream).then(
      (result) => ({ result }),
      (error) => ({ error }),
    );
    const { chunks, audioDurationMs } = await createSpeechPcm(
      provider.sampleRate,
      options.chunkMs,
      options.trailingSilenceMs,
      options.internalSilenceMs,
      options.repeat,
    );
    const audioStartedAt = performance.now();
    for (const chunk of chunks) {
      await providerSession.sendAudio(chunk);
      await delay(options.chunkMs, undefined, {
        signal: abortController.signal,
      });
    }
    const finishStartedAt = performance.now();
    await providerSession.finish();
    const outcome = await streamResult;
    if ("error" in outcome) {
      throw outcome.error;
    }
    const finalTranscript = outcome.result.parts
      .filter((part) => part.type === "final")
      .map((part) => part.text)
      .join(" ")
      .trim();
    const finals = outcome.result.parts.filter((part) => part.type === "final");
    if (
      finals.some(
        (part) => typeof part.segmentId !== "string" || !part.segmentId,
      )
    ) {
      throw new Error("Provider emitted a final without segment identity.");
    }
    if (new Set(finals.map((part) => part.segmentId)).size !== finals.length) {
      throw new Error("Provider emitted a duplicate segment final.");
    }
    if (
      options.repeat > 1 &&
      finals.filter((part) => part.text.length > 0).length < options.repeat
    ) {
      throw new Error(
        `The repeated fixture did not produce distinct committed segments: ${JSON.stringify(finals)}`,
      );
    }
    if (finalTranscript.length === 0) {
      throw new Error("Provider returned no committed final transcript.");
    }

    if (tokenMetadata === undefined) {
      throw new Error(
        "The server token handler did not report a minted token.",
      );
    }

    const completedAt = performance.now();
    const result = {
      provider: smokeCase.name,
      model: provider.modelId,
      reference: Array(options.repeat).fill("BY HARRY QUILTER M A").join(" "),
      repeat: options.repeat,
      transcript: finalTranscript,
      wordErrorRate: wordErrorRate(
        Array(options.repeat).fill("BY HARRY QUILTER M A").join(" "),
        finalTranscript,
      ),
      chunkMs: options.chunkMs,
      audioDurationMs: Math.round(audioDurationMs),
      internalSilenceMs: options.internalSilenceMs,
      trailingSilenceMs: options.trailingSilenceMs,
      endpointing:
        options.endpointing === undefined
          ? smokeCase.defaultEndpointing
          : options.endpointing === false
            ? "manual"
            : options.endpointing.silenceMs,
      connectionMs: milliseconds(connectedAt - connectionStartedAt),
      firstInterimMs:
        outcome.result.firstInterimAt === undefined
          ? null
          : milliseconds(outcome.result.firstInterimAt - audioStartedAt),
      firstFinalMs:
        outcome.result.firstFinalAt === undefined
          ? null
          : milliseconds(outcome.result.firstFinalAt - audioStartedAt),
      finalizationMs: milliseconds(completedAt - finishStartedAt),
      interimParts: outcome.result.parts.filter(
        (part) => part.type === "interim",
      ).length,
      finalParts: outcome.result.parts.filter(
        (part) => part.type === "final" && part.text.length > 0,
      ).length,
      segments: outcome.result.parts
        .filter((part) => part.type === "final")
        .map((part) => ({ segmentId: part.segmentId, text: part.text })),
      tokenExpiresIn:
        "expiresIn" in tokenMetadata ? tokenMetadata.expiresIn : null,
    };
    abortController.abort("credential-smoke-complete");
    console.log(
      options.json
        ? JSON.stringify(result)
        : `${smokeCase.name}: token minted, speech streamed, committed final received (${JSON.stringify(finalTranscript)}); WER ${result.wordErrorRate.toFixed(3)}, connection ${result.connectionMs} ms, first interim ${result.firstInterimMs ?? "none"} ms, finalization ${result.finalizationMs} ms`,
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

async function createSpeechPcm(
  sampleRate,
  chunkMs,
  trailingSilenceMs,
  internalSilenceMs,
  repeat = 1,
) {
  const wav = await readFile(
    new URL(
      "../fixtures/audio/librispeech-1272-128104-0014.wav",
      import.meta.url,
    ),
  );
  const source = readPcm16Wav(wav);
  const resampled = resamplePcm16(
    source.samples,
    source.sampleRate,
    sampleRate,
  );
  const speech = insertSilence(resampled, sampleRate, 1_294, internalSilenceMs);
  const samples = new Int16Array(
    speech.length * repeat +
      sampleRate * 2 * (repeat - 1) +
      Math.round((sampleRate * trailingSilenceMs) / 1_000),
  );
  for (let index = 0; index < repeat; index++)
    samples.set(speech, index * (speech.length + sampleRate * 2));
  const chunkLength = Math.max(1, Math.round((sampleRate * chunkMs) / 1_000));
  const chunks = [];
  for (let offset = 0; offset < samples.length; offset += chunkLength) {
    chunks.push(samples.slice(offset, offset + chunkLength));
  }
  return {
    chunks,
    audioDurationMs: (samples.length / sampleRate) * 1_000,
  };
}

function insertSilence(samples, sampleRate, atMs, durationMs) {
  if (durationMs === 0) {
    return samples;
  }
  const split = Math.min(
    samples.length,
    Math.round((sampleRate * atMs) / 1_000),
  );
  const silenceLength = Math.round((sampleRate * durationMs) / 1_000);
  const output = new Int16Array(samples.length + silenceLength);
  output.set(samples.subarray(0, split));
  output.set(samples.subarray(split), split + silenceLength);
  return output;
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
  let firstInterimAt;
  let firstFinalAt;
  const reader = stream.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        return { parts, firstInterimAt, firstFinalAt };
      }
      if (result.value.type === "error") {
        throw result.value.error;
      }
      if (result.value.type === "interim") {
        firstInterimAt ??= performance.now();
      } else if (result.value.type === "final") {
        firstFinalAt ??= performance.now();
      }
      parts.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
}

function milliseconds(value) {
  return Math.round(value * 10) / 10;
}

function safeErrorMessage(error) {
  if (error !== null && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "Unknown provider failure.";
}
