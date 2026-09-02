import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const candidateSha = process.argv[2];
const repository = process.env.GITHUB_REPOSITORY ?? "VoiceInput/voiceinput";
if (!/^[0-9a-f]{40}$/.test(candidateSha ?? "")) {
  throw new Error("A full candidate commit SHA is required.");
}

const pages = JSON.parse(
  execFileSync(
    "gh",
    [
      "api",
      "--paginate",
      "--slurp",
      `repos/${repository}/actions/runs?head_sha=${candidateSha}&per_page=100`,
    ],
    { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 },
  ),
);
const allRuns = pages.flatMap((page) => page.workflow_runs);
if (allRuns.length !== pages[0]?.total_count) {
  throw new Error("GitHub returned an incomplete workflow-run history.");
}
const runs = allRuns.filter(
  (run) => run.status === "completed" && run.head_sha === candidateSha,
);
if (runs.length === 0) {
  throw new Error(`No completed workflow logs exist for ${candidateSha}.`);
}

const directory = mkdtempSync(join(tmpdir(), "voiceinput-workflow-logs-"));
try {
  for (const run of runs) {
    const archive = join(directory, `${run.id}.zip`);
    const destination = join(directory, String(run.id));
    writeFileSync(
      archive,
      execFileSync(
        "gh",
        ["api", `repos/${repository}/actions/runs/${run.id}/logs`],
        { maxBuffer: 100 * 1024 * 1024 },
      ),
    );
    mkdirSync(destination);
    execFileSync("unzip", ["-q", archive, "-d", destination]);
  }
  execFileSync("node", ["scripts/scan-secrets.mjs", "logs", directory], {
    stdio: "inherit",
  });
} finally {
  rmSync(directory, { force: true, recursive: true });
}
