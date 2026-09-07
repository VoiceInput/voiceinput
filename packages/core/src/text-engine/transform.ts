export const DEFAULT_TRANSFORM_TIMEOUT_MS = 10_000;

export class TransformTimeoutError extends Error {
  constructor() {
    super("Transcript transform timed out.");
    this.name = "TransformTimeoutError";
  }
}

export async function runTransformWithTimeout(
  transform: () => unknown,
  timeoutMs: number,
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = transform();
    return await Promise.race([
      Promise.resolve(result),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new TransformTimeoutError()),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
