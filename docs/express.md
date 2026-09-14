# Express

Bridge an existing Express route to a VoiceInput token handler. The handler
accepts a web `Request` and returns a web `Response`. The bridge preserves your
cookies and authorization headers while translating those objects.

## Install

**npm**

```bash
npm install @voiceinput/openai express
```

**pnpm**

```bash
pnpm add @voiceinput/openai express
```

Set `OPENAI_API_KEY` and `APP_ORIGIN` in the server environment. Install
`@voiceinput/react` and the same provider adapter in the React application.

## Add the token route

```ts
import { createOpenAITokenHandler } from "@voiceinput/openai/server";
import express, {
  type Request as ExpressRequest,
  type Response as ExpressResponse,
} from "express";
import { getCurrentUser } from "./auth.js"; // your existing session check

const appOrigin = new URL(process.env.APP_ORIGIN!).origin;
const issueVoiceToken = createOpenAITokenHandler({
  apiKey: process.env.OPENAI_API_KEY!,
  authorize: async (request) => {
    if (request.headers.get("origin") !== appOrigin) return null;
    const user = await getCurrentUser(request);
    return user ? { subject: user.id } : null;
  },
});

const app = express();

app.post(
  "/api/voice-token",
  express.json({ limit: "16kb" }),
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

Configure Express `trust proxy` correctly before relying on `request.protocol`.
Keep the browser adapter on a relative endpoint such as `/api/voice-token` so
session cookies stay same-origin.

The bridge also works with `createElevenLabsTokenHandler` and
`createDeepgramTokenHandler`. Add your session library and shared quota with the
[authentication recipes](authentication-recipes.md), then follow the
[quickstart field setup](quickstart.md#4-add-the-field).
