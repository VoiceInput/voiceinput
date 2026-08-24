import { createDeepgramTokenHandler } from "@voiceinput/deepgram/server";
import { createElevenLabsTokenHandler } from "@voiceinput/elevenlabs/server";
import { createOpenAITokenHandler } from "@voiceinput/openai/server";
import {
  authorizeDevRequest,
  getDevAuthSecret,
} from "@voiceinput/playground-auth";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const secret = getDevAuthSecret();
    const authorize = (tokenRequest: Request) =>
      authorizeDevRequest(tokenRequest, { secret });
    switch (new URL(request.url).searchParams.get("provider") ?? "openai") {
      case "openai":
        return await createOpenAITokenHandler({
          apiKey: readEnvironment("OPENAI_API_KEY"),
          authorize,
        })(request);
      case "elevenlabs":
        return await createElevenLabsTokenHandler({
          apiKey: readEnvironment("ELEVENLABS_API_KEY"),
          authorize,
        })(request);
      case "deepgram":
        return await createDeepgramTokenHandler({
          apiKey: readEnvironment("DEEPGRAM_API_KEY"),
          authorize,
        })(request);
      default:
        return Response.json(
          {
            error: {
              code: "invalid-configuration",
              message: "Unknown voice provider.",
            },
          },
          { status: 400 },
        );
    }
  } catch {
    return Response.json(
      {
        error: {
          code: "fixture-unavailable",
          message: "The local token fixture is unavailable.",
        },
      },
      { status: 500 },
    );
  }
}

function readEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`${name} is unavailable.`);
  }
  return value;
}
