import { createOpenAITokenHandler } from "@voiceinput/openai/server";
import {
  authorizeDevRequest,
  getDevAuthSecret,
} from "@voiceinput/playground-auth";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const secret = getDevAuthSecret();
    return await createOpenAITokenHandler({
      apiKey: readEnvironment("OPENAI_API_KEY"),
      authorize: (tokenRequest) =>
        authorizeDevRequest(tokenRequest, { secret }),
    })(request);
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
