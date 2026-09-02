import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PUBLIC_PACKAGES = [
  "@voiceinput/provider",
  "@voiceinput/core",
  "@voiceinput/openai",
  "@voiceinput/elevenlabs",
  "@voiceinput/deepgram",
  "@voiceinput/react",
];

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const shaPattern = /^[0-9a-f]{40}$/;
const distTagPattern = /^[a-z][a-z0-9._-]*$/;

export function createReleasePlan(state) {
  const errors = [];
  const version = state.expectedVersion ?? "";
  const approvedSha = state.approvedSha ?? "";
  const distTag = state.distTag ?? "";

  if (!semverPattern.test(version) || version === "0.0.0") {
    errors.push(
      "release version must be an explicit non-0.0.0 semantic version",
    );
  }
  if (!shaPattern.test(approvedSha)) {
    errors.push("approved candidate SHA must be an explicit full commit SHA");
  } else if (approvedSha !== state.headSha) {
    errors.push("approved candidate SHA does not match HEAD");
  }
  if (distTag === "" || !distTagPattern.test(distTag)) {
    errors.push("npm dist-tag must be explicit and start with a letter");
  } else if (version.includes("-") && distTag !== "next") {
    errors.push("prerelease versions must use the next dist-tag");
  }
  if (state.manifestSha !== approvedSha) {
    errors.push("artifact manifest was not created for the approved candidate");
  }
  if (!state.releaseInputsClean) {
    errors.push("release inputs differ from the approved candidate");
  }
  if (state.pendingChangesets.length > 0) {
    errors.push("release Changeset has not been consumed");
  }

  const packageNames = state.packages.map(({ name }) => name);
  if (
    packageNames.length !== PUBLIC_PACKAGES.length ||
    PUBLIC_PACKAGES.some((name) => !packageNames.includes(name))
  ) {
    errors.push("release must contain exactly the six public packages");
  }
  for (const package_ of state.packages) {
    if (package_.version !== version) {
      errors.push(`${package_.name} does not match release version ${version}`);
    }
    if (!package_.hasReleaseNotes) {
      errors.push(
        `${package_.name} has no consumed Changeset entry for ${version}`,
      );
    }
  }

  const artifacts = new Map(
    state.artifacts.map((artifact) => [artifact.name, artifact]),
  );
  if (
    artifacts.size !== PUBLIC_PACKAGES.length ||
    PUBLIC_PACKAGES.some((name) => !artifacts.has(name))
  ) {
    errors.push(
      "artifact manifest must contain exactly the six public packages",
    );
  }
  for (const name of PUBLIC_PACKAGES) {
    const artifact = artifacts.get(name);
    if (artifact === undefined) continue;
    if (artifact.version !== version) {
      errors.push(`${name} tarball does not match release version ${version}`);
    }
    if (!artifact.valid) {
      errors.push(
        `${name} tarball does not match the validated artifact manifest`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(`Release blocked:\n- ${errors.join("\n- ")}`);
  }

  return {
    approvedSha,
    distTag,
    version,
    artifacts: PUBLIC_PACKAGES.map((name) => artifacts.get(name)),
  };
}

function readReleaseState() {
  const expectedVersion = process.env.VOICEINPUT_RELEASE_VERSION;
  const approvedSha = process.env.VOICEINPUT_RELEASE_SHA;
  const distTag = process.env.VOICEINPUT_RELEASE_TAG;
  const manifestPath = join(rootDirectory, ".release-manifest.json");
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : { candidateSha: "", packages: [] };
  const pendingChangesets = readdirSync(
    join(rootDirectory, ".changeset"),
  ).filter((fileName) => fileName.endsWith(".md") && fileName !== "README.md");
  const packages = PUBLIC_PACKAGES.map((name) => {
    const directory = name.slice("@voiceinput/".length);
    const packageDirectory = join(rootDirectory, "packages", directory);
    const packageJson = JSON.parse(
      readFileSync(join(packageDirectory, "package.json"), "utf8"),
    );
    const changelogPath = join(packageDirectory, "CHANGELOG.md");
    return {
      name: packageJson.name,
      version: packageJson.version,
      hasReleaseNotes:
        expectedVersion !== undefined &&
        existsSync(changelogPath) &&
        readFileSync(changelogPath, "utf8")
          .split("\n")
          .includes(`## ${expectedVersion}`),
    };
  });
  const artifacts = manifest.packages.map((artifact) => {
    const directory = artifact.name.slice("@voiceinput/".length);
    const expectedPath = `packages/${directory}/voiceinput-${directory}-${artifact.version}.tgz`;
    const artifactPath = resolve(rootDirectory, artifact.path);
    const validPath = artifact.path === expectedPath;
    const exists = validPath && existsSync(artifactPath);
    const actualHash = exists
      ? createHash("sha512").update(readFileSync(artifactPath)).digest("hex")
      : "";
    return {
      ...artifact,
      absolutePath: artifactPath,
      valid:
        exists &&
        artifact.sha512 === actualHash &&
        artifact.size === statSync(artifactPath).size,
    };
  });

  return {
    approvedSha,
    artifacts,
    distTag,
    expectedVersion,
    headSha: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: rootDirectory,
      encoding: "utf8",
    }).trim(),
    manifestSha: manifest.candidateSha,
    packages,
    pendingChangesets,
    releaseInputsClean:
      execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
        cwd: rootDirectory,
        encoding: "utf8",
      }).trim() === "",
  };
}

function printPlan(plan) {
  console.log(`Approved candidate: ${plan.approvedSha}`);
  console.log(`npm dist-tag: ${plan.distTag}`);
  for (const artifact of plan.artifacts) {
    console.log(
      `${artifact.name}@${plan.version}  sha512:${artifact.sha512}  ${artifact.path}`,
    );
  }
}

export function publishRelease(
  plan,
  approval,
  run = (command, arguments_) =>
    execFileSync(command, arguments_, { cwd: rootDirectory, stdio: "inherit" }),
) {
  if (approval !== "PUBLISH") {
    throw new Error("Release blocked: explicit PUBLISH approval is required");
  }
  for (const artifact of plan.artifacts) {
    run("npm", [
      "publish",
      artifact.absolutePath,
      "--tag",
      plan.distTag,
      "--access",
      "public",
      "--provenance",
      "--registry",
      "https://registry.npmjs.org",
    ]);
  }
}

function main() {
  const command = process.argv[2];
  if (command !== "plan" && command !== "publish") {
    throw new Error("Usage: node scripts/release.mjs <plan|publish>");
  }
  const plan = createReleasePlan(readReleaseState());
  printPlan(plan);
  if (command === "publish") {
    publishRelease(plan, process.env.VOICEINPUT_RELEASE_APPROVAL);
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main();
}
