import {
  createDevAuthResponse,
  getDevAuthSecret,
  readDevAuthMode,
} from "@voiceinput/playground-auth";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const mode = readDevAuthMode(await readJson(request));
  if (mode === null) {
    return Response.json(
      { error: { code: "invalid-request", message: "Invalid auth mode." } },
      { status: 400 },
    );
  }
  try {
    return await createDevAuthResponse(request, {
      mode,
      secret: getDevAuthSecret(),
    });
  } catch {
    return Response.json(
      { error: { code: "fixture-disabled", message: "Fixture unavailable." } },
      { status: 403 },
    );
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
