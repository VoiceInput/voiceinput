import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.argv[2];

if (mode === "repository") {
  runGitleaks("git", root);
  withTemporaryDirectory("voiceinput-tree-", (directory) => {
    const archive = join(directory, "repository.tar");
    writeFileSync(
      archive,
      execFileSync("git", ["archive", "--format=tar", "HEAD"], {
        cwd: root,
        maxBuffer: 100 * 1024 * 1024,
      }),
    );
    const tree = join(directory, "tree");
    mkdirSync(tree);
    run("tar", ["-xf", archive, "-C", tree]);
    runGitleaks("dir", tree);
  });
} else if (mode === "tarballs") {
  const tarballs = readdirSync(join(root, "packages"), {
    withFileTypes: true,
  }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const directory = join(root, "packages", entry.name);
    return readdirSync(directory)
      .filter((fileName) => fileName.endsWith(".tgz"))
      .map((fileName) => join(directory, fileName));
  });
  if (tarballs.length !== 6) {
    throw new Error(`Expected six package tarballs, found ${tarballs.length}.`);
  }
  withTemporaryDirectory("voiceinput-tarballs-", (directory) => {
    for (const tarball of tarballs) {
      const destination = join(directory, basename(tarball, ".tgz"));
      mkdirSync(destination);
      run("tar", ["-xzf", tarball, "-C", destination]);
    }
    runGitleaks("dir", directory);
  });
} else if (mode === "logs") {
  const logs = process.argv[3];
  if (!logs) throw new Error("Usage: scan-secrets.mjs logs <directory>");
  runGitleaks("dir", resolve(logs));
} else {
  throw new Error(
    "Usage: scan-secrets.mjs <repository|tarballs|logs> [directory]",
  );
}

function runGitleaks(command, source) {
  run("gitleaks", [command, "--redact", "--verbose", source]);
}

function run(command, arguments_) {
  execFileSync(command, arguments_, { cwd: root, stdio: "inherit" });
}

function withTemporaryDirectory(prefix, callback) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  try {
    callback(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}
