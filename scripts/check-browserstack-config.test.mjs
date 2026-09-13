import { describe, expect, test } from "vitest";

import { validateBrowserStackConfig } from "./check-browserstack-config.mjs";

const valid = `userName: \${BROWSERSTACK_USERNAME}
accessKey: \${BROWSERSTACK_ACCESS_KEY}
platforms:
  - os: Windows
    browserName: chrome
browserstackLocal: true
`;

describe("BrowserStack configuration preflight", () => {
  test("reports missing environment names without exposing values", () => {
    const result = validateBrowserStackConfig(valid, {
      BROWSERSTACK_ACCESS_KEY: "secret-access-key",
    });
    expect(result.missingEnvironment).toEqual(["BROWSERSTACK_USERNAME"]);
    expect(JSON.stringify(result)).not.toContain("secret-access-key");
  });

  test("classifies incomplete static configuration before cloud sessions", () => {
    const result = validateBrowserStackConfig("platforms:\n", {
      BROWSERSTACK_USERNAME: "user",
      BROWSERSTACK_ACCESS_KEY: "key",
    });
    expect(result.problems).toEqual([
      "browserstack.yml must read BROWSERSTACK_USERNAME.",
      "browserstack.yml must read BROWSERSTACK_ACCESS_KEY.",
      "browserstackLocal must be enabled for local playgrounds.",
      "At least one supported branded desktop browser is required.",
    ]);
  });
});
