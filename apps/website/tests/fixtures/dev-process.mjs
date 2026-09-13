import { createServer } from "node:http";
import { spawn } from "node:child_process";

const port = Number(process.argv[2]);
// A descendant that ignores graceful shutdown exercises the forced cleanup path.
const descendant = spawn(
  process.execPath,
  ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
  { stdio: "ignore" },
);
createServer((req, res) => {
  if (req.url === "/crash") process.exit(9);
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      status: "ready",
      pid: process.pid,
      descendant: descendant.pid,
    }),
  );
}).listen(port, "127.0.0.1");
