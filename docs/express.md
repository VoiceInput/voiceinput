# Express bridge

Official token handlers accept a standard web `Request` and return a standard
web `Response`. An existing Express application can bridge those objects in a
few lines; VoiceInput does not need an Express-specific package.

This example assumes `express.json()` has parsed the small JSON token request.

```ts
import { createOpenAITokenHandler } from "@voiceinput/openai/server";
import express, {
  type Request as ExpressRequest,
  type Response as ExpressResponse,
} from "express";

import { authenticateRequest } from "./auth.js";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is required.");

const issueVoiceToken = createOpenAITokenHandler({
  apiKey,
  authorize: async (request) => {
    const user = await authenticateRequest(request);
    return user ? { subject: user.id } : null;
  },
});

const app = express();

app.post(
  "/api/voice-token",
  express.json({ limit: "8kb" }),
  async (request, response, next) => {
    try {
      const webRequest = toWebRequest(request);
      const webResponse = await issueVoiceToken(webRequest);
      await sendWebResponse(response, webResponse);
    } catch (error) {
      next(error);
    }
  },
);

function toWebRequest(request: ExpressRequest): Request {
  const host = request.get("host");
  if (!host) throw new Error("Missing Host header.");

  const headers = new Headers();
  for (const [name, rawValue] of Object.entries(request.headers)) {
    if (
      rawValue === undefined ||
      name === "content-length" ||
      name === "transfer-encoding"
    ) {
      continue;
    }
    for (const value of Array.isArray(rawValue) ? rawValue : [rawValue]) {
      headers.append(name, value);
    }
  }
  headers.set("content-type", "application/json");

  const abortController = new AbortController();
  request.once("aborted", () => abortController.abort());

  return new Request(
    new URL(request.originalUrl, `${request.protocol}://${host}`),
    {
      method: request.method,
      headers,
      body: JSON.stringify(request.body ?? {}),
      signal: abortController.signal,
    },
  );
}

async function sendWebResponse(
  response: ExpressResponse,
  webResponse: Response,
): Promise<void> {
  response.status(webResponse.status);
  webResponse.headers.forEach((value, name) => {
    response.setHeader(name, value);
  });
  response.send(Buffer.from(await webResponse.arrayBuffer()));
}
```

The copied headers preserve cookies and authorization headers for your
`authorize` implementation. Re-serializing the parsed JSON body is safe for the
provider token handlers, which accept a small JSON object and reject unknown
fields.

If your route is mounted behind a trusted reverse proxy, configure Express
`trust proxy` correctly before relying on `request.protocol`. Prefer a relative,
same-origin token endpoint in the browser.

The same bridge works with `createElevenLabsTokenHandler` and
`createDeepgramTokenHandler`. Keep the selected provider's long-lived key in the
Express server environment and retain the required `authorize` callback.
