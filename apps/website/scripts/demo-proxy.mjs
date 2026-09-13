// Vite only uses this proxy in development; no instructions enter the public bundle.
export const demoProxy = {
  target: "http://127.0.0.1:4322",
  ws: true,
  configure(proxy) {
    proxy.on("error", (_error, _request, response) => {
      // WebSocket failures receive a socket rather than an HTTP ServerResponse.
      if (!("writeHead" in response) || response.headersSent) return;
      response.writeHead(503, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          error:
            "The local demo backend is unavailable. Restart pnpm --filter @voiceinput/website dev to start both servers.",
          code: "local-backend-unavailable",
        }),
      );
    });
  },
};
