import { describe, expect, it, vi } from "vitest";

import {
  createReleasePlan,
  PUBLIC_PACKAGES,
  publishRelease,
} from "./release.mjs";

const sha = "a".repeat(40);

function validState() {
  return {
    approvedSha: sha,
    artifacts: PUBLIC_PACKAGES.map((name) => ({
      name,
      path: `${name}.tgz`,
      sha512: "b".repeat(128),
      valid: true,
      version: "0.1.0-beta.0",
    })),
    distTag: "next",
    expectedVersion: "0.1.0-beta.0",
    headSha: sha,
    manifestSha: sha,
    packages: PUBLIC_PACKAGES.map((name) => ({
      hasReleaseNotes: true,
      name,
      version: "0.1.0-beta.0",
    })),
    pendingChangesets: [] as string[],
    releaseInputsClean: true,
  };
}

describe("release gate", () => {
  it("accepts one approved, versioned, explicit, validated package suite", () => {
    const plan = createReleasePlan(validState());
    expect(plan.artifacts.map(({ name }) => name)).toEqual(PUBLIC_PACKAGES);
  });

  it("blocks 0.0.0", () => {
    const state = validState();
    state.expectedVersion = "0.0.0";
    state.packages = state.packages.map((package_) => ({
      ...package_,
      version: "0.0.0",
    }));
    state.artifacts = state.artifacts.map((artifact) => ({
      ...artifact,
      version: "0.0.0",
    }));
    expect(() => createReleasePlan(state)).toThrow("non-0.0.0");
  });

  it("blocks mixed package versions", () => {
    const state = validState();
    state.packages[1] = { ...state.packages[1], version: "0.1.0-beta.1" };
    expect(() => createReleasePlan(state)).toThrow("does not match");
  });

  it("blocks a candidate SHA other than HEAD", () => {
    const state = validState();
    state.approvedSha = "c".repeat(40);
    expect(() => createReleasePlan(state)).toThrow("does not match HEAD");
  });

  it("blocks missing or unconsumed Changeset evidence", () => {
    const missing = validState();
    missing.packages[0] = {
      ...missing.packages[0],
      hasReleaseNotes: false,
    };
    expect(() => createReleasePlan(missing)).toThrow("no consumed Changeset");

    const pending = validState();
    pending.pendingChangesets.push("initial-prerelease.md");
    expect(() => createReleasePlan(pending)).toThrow("has not been consumed");
  });

  it("blocks an implicit dist-tag and a prerelease latest tag", () => {
    const missing = validState();
    missing.distTag = "";
    expect(() => createReleasePlan(missing)).toThrow(
      "dist-tag must be explicit",
    );

    const latest = validState();
    latest.distTag = "latest";
    expect(() => createReleasePlan(latest)).toThrow(
      "prerelease versions cannot use the latest",
    );
  });

  it("blocks tarballs that differ from the validated manifest", () => {
    const state = validState();
    state.artifacts[0] = { ...state.artifacts[0], valid: false };
    expect(() => createReleasePlan(state)).toThrow(
      "does not match the validated",
    );
  });

  it("blocks release inputs modified after the approved commit", () => {
    const state = validState();
    state.releaseInputsClean = false;
    expect(() => createReleasePlan(state)).toThrow(
      "release inputs differ from the approved candidate",
    );
  });

  it("does not invoke npm when publish approval is absent", () => {
    const run = vi.fn<(command: string, arguments_: string[]) => void>();
    const plan = createReleasePlan(validState());
    expect(() => publishRelease(plan, undefined, run)).toThrow(
      "explicit PUBLISH approval is required",
    );
    expect(run).not.toHaveBeenCalled();
  });
});
