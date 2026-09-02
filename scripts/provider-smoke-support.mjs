const PROVIDERS = ["openai", "elevenlabs", "deepgram"];

export function readRunOptions(arguments_) {
  const provider = readArgument(arguments_, "provider");
  if (provider !== undefined && !PROVIDERS.includes(provider)) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  const model = readArgument(arguments_, "model");
  if (model !== undefined && provider === undefined) {
    throw new Error("--model requires --provider.");
  }
  const languageArgument = readArgument(arguments_, "language") ?? "en-US";
  const endpointingArgument = readArgument(arguments_, "endpointing");
  return {
    provider,
    model,
    language: languageArgument === "auto" ? undefined : languageArgument,
    vocabulary: (readArgument(arguments_, "vocabulary") ?? "")
      .split(",")
      .filter(Boolean),
    chunkMs: readNumberArgument(arguments_, "chunk-ms", 20, 1, 1_000),
    trailingSilenceMs: readNumberArgument(
      arguments_,
      "trailing-silence-ms",
      0,
      0,
      10_000,
    ),
    internalSilenceMs: readNumberArgument(
      arguments_,
      "internal-silence-ms",
      0,
      0,
      10_000,
    ),
    endpointing:
      endpointingArgument === undefined
        ? undefined
        : endpointingArgument === "false"
          ? false
          : {
              silenceMs: readNumber(
                endpointingArgument,
                "endpointing",
                1,
                3_000,
              ),
            },
    json: arguments_.includes("--json"),
  };
}

export function wordErrorRate(reference, transcript) {
  const expected = words(reference);
  const actual = words(transcript);
  const previous = Array.from(
    { length: actual.length + 1 },
    (_, index) => index,
  );
  for (let row = 1; row <= expected.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= actual.length; column += 1) {
      current[column] = Math.min(
        (current[column - 1] ?? 0) + 1,
        (previous[column] ?? 0) + 1,
        (previous[column - 1] ?? 0) +
          (expected[row - 1] === actual[column - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return (previous[actual.length] ?? expected.length) / expected.length;
}

function readArgument(arguments_, name) {
  const prefix = `--${name}=`;
  return arguments_
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

function readNumberArgument(arguments_, name, defaultValue, minimum, maximum) {
  const value = readArgument(arguments_, name);
  return value === undefined
    ? defaultValue
    : readNumber(value, name, minimum, maximum);
}

function readNumber(value, name, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(
      `--${name} must be a safe integer from ${minimum} to ${maximum}.`,
    );
  }
  return number;
}

function words(value) {
  return (
    value
      .normalize("NFKD")
      .replaceAll(/\p{Mark}/gu, "")
      .toLocaleLowerCase("en")
      .match(/[\p{Letter}\p{Number}]+/gu) ?? []
  );
}
