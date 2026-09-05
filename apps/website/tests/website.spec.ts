import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockDemo } from "./demo-fixture";
import { readFileSync } from "node:fs";

async function writingOption(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Writing options", exact: true })
    .click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

test("denied microphone permission leaves the field editable and does not request a session", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/demo/session", (route) => {
    requests++;
    return route.fulfill({ status: 500 });
  });
  await page.addInitScript(() => {
    Object.defineProperty(MediaDevices.prototype, "getUserMedia", {
      value: async () => {
        throw new DOMException("Permission denied", "NotAllowedError");
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.locator(".demo-status:visible")).toContainText(
    /permission|denied/i,
  );
  await expect(
    page.getByRole("textbox", { name: "Try voice input" }),
  ).toBeEditable();
  await expect(
    page.getByRole("button", { name: "Start recording" }),
  ).toBeEnabled();
  expect(requests).toBe(0);
});

test("rate limits stop the microphone and show a useful message", async ({
  page,
}) => {
  await mockDemo(page);
  await page.route("**/api/demo/session", (route) =>
    route.fulfill({ status: 429, headers: { "Retry-After": "3600" } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.locator(".demo-status:visible")).toContainText(
    "demo limit has been reached",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-microphone-stopped",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Start recording" }),
  ).toBeEnabled();
});

test("an unavailable server shows an error and releases the microphone", async ({
  page,
}) => {
  await mockDemo(page);
  await page.route("**/api/demo/session", (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.locator(".demo-status:visible")).toContainText(
    "unavailable right now",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-microphone-stopped",
    "true",
  );
});

test("live demo records audio, edits at the cursor, and supports undo", async ({
  page,
}) => {
  const stats = await mockDemo(page);
  const external: string[] = [];
  page.on("request", (request) => {
    if (
      !request.url().startsWith("http://127.0.0.1:4322") &&
      !request.url().startsWith("data:") &&
      !request.url().startsWith("blob:")
    )
      external.push(request.url());
  });
  await page.goto("/");
  const field = page.getByRole("textbox", { name: "Try voice input" });
  await field.scrollIntoViewIfNeeded();
  await expect(field).toBeEditable();
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-microphone-requests",
    "1",
  );
  await field.fill("Before. After.");
  await field.evaluate((node: HTMLTextAreaElement) =>
    node.setSelectionRange(8, 8),
  );
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(
    page.getByRole("button", { name: "Start recording" }),
  ).toBeVisible({
    timeout: 15000,
  });
  await expect(field).toHaveValue(
    /Before\. The meeting starts at ten\. Please bring your notes\. After\.$/,
  );
  await writingOption(page, "Undo last edit");
  await expect(field).toHaveValue("Before. The meeting starts at ten. After.");
  await writingOption(page, "Undo last edit");
  await expect(field).toHaveValue("Before. After.");
  await writingOption(page, "Start over");
  await expect(field).toHaveValue("");
  expect(external).toEqual([]);
  expect(stats.audioBytes).toBeGreaterThan(0);
  await expect(page.locator("html")).toHaveAttribute(
    "data-microphone-requests",
    "1",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-microphone-stopped",
    "true",
  );
});

test("manual edits during recording are preserved", async ({ page }) => {
  await mockDemo(page);
  await page.goto("/#demo");
  const field = page.getByRole("textbox", { name: "Try voice input" });
  await expect(field).toBeEditable();
  await field.fill("Original. ");
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(field).toHaveValue(/The meeting/);
  await expect(field).toBeEditable();
  await field.fill("My correction. ");
  await expect(field).toHaveValue(/My correction\. Please bring/);
  await expect(
    page.getByRole("button", { name: "Start recording" }),
  ).toBeVisible();
  await expect(field).toHaveValue(/My correction\. Please bring your notes\./);
});

test("accessible homepage and quickstart with real code", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Try voice input" })
    .scrollIntoViewIfNeeded();
  const home = await new AxeBuilder({ page }).analyze();
  expect(home.violations).toEqual([]);
  await page.getByRole("link", { name: "Read the quickstart" }).first().click();
  await expect(page).toHaveURL(/\/docs\/quickstart\/?$/);
  await expect(page.locator("main")).toContainText("createOpenAITokenHandler");
  await expect(page.locator("main")).toContainText("@voiceinput/react@next");
  const docs = await new AxeBuilder({ page }).analyze();
  expect(docs.violations).toEqual([]);
  await page
    .locator("starlight-theme-select select:visible")
    .selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const darkDocs = await new AxeBuilder({ page }).analyze();
  expect(darkDocs.violations).toEqual([]);
});

test("mobile layout, reduced motion and documentation navigation", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (testInfo.project.name === "chromium")
    await page.screenshot({
      path: "../../output/playwright/website-mobile.png",
      fullPage: true,
    });
  await page.goto("/docs/quickstart");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(
    page
      .getByRole("navigation", { name: "Main", exact: true })
      .getByRole("link", { name: "React API", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("desktop composition and tablet fit", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator("body")).toHaveCSS(
    "font-family",
    /"?Wix Madefor Text Variable"?, sans-serif/,
  );
  await expect(page.locator("h1")).toHaveCSS("color", "rgb(32, 34, 38)");
  await expect(
    page.getByRole("textbox", { name: "Try voice input" }),
  ).toBeEditable();
  const recordingButton = await page
    .getByRole("button", { name: "Start recording" })
    .boundingBox();
  expect(recordingButton!.y + recordingButton!.height).toBeLessThan(900);
  if (testInfo.project.name === "chromium")
    await page.screenshot({
      path: "../../output/playwright/website-desktop.png",
      fullPage: true,
    });
  await page.setViewportSize({ width: 820, height: 1180 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (testInfo.project.name === "chromium")
    await page.screenshot({
      path: "../../output/playwright/website-tablet.png",
      fullPage: true,
    });
});

test("content and docs remain useful without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4322/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Add voice input to your React app.",
  );
  await page.getByRole("link", { name: "Read the quickstart" }).first().click();
  await expect(page.locator("main")).toContainText("createOpenAITokenHandler");
  await context.close();
});

test("demo can stop early and restart", async ({ page }) => {
  await mockDemo(page);
  await page.goto("/");
  const field = page.getByRole("textbox", { name: "Try voice input" });
  await expect(field).toBeEditable();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(field).toHaveValue(/The meeting/);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(
    page.getByRole("button", { name: "Start recording" }),
  ).toBeVisible();
  await writingOption(page, "Start over");
  await expect(field).toHaveValue("");
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(field).toHaveValue(/^The meeting/);
});

test("package tabs sync across groups and persist from homepage to docs", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "pnpm", exact: true }).click();
  await expect(
    page.getByRole("tabpanel", { name: "pnpm", exact: true }),
  ).toContainText("pnpm add @voiceinput/react@next");
  await page
    .getByRole("link", { name: "Read the quickstart", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("tab", { name: "pnpm", exact: true }).first(),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("tab", { name: "pnpm", exact: true }).last(),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("tabpanel", { name: "pnpm", exact: true }).last(),
  ).toContainText("pnpm run dev");
  await page.getByRole("tab", { name: "pnpm", exact: true }).first().focus();
  await page.keyboard.press("ArrowLeft");
  await expect(
    page.getByRole("tab", { name: "npm", exact: true }).last(),
  ).toHaveAttribute("aria-selected", "true");
});

test("copy copies the selected command without labels", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.copied = text;
        },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("tab", { name: "pnpm", exact: true }).click();
  await page.getByRole("button", { name: "Copy pnpm install command" }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-copied",
    "pnpm add @voiceinput/react@next @voiceinput/openai@next",
  );
  await page.goto("/docs/quickstart/");
  await page
    .getByRole("tabpanel", { name: "pnpm", exact: true })
    .first()
    .getByRole("button", { name: "Copy to clipboard" })
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-copied",
    "pnpm add @voiceinput/react@next @voiceinput/openai@next",
  );
});

test("docs menu remains usable when switching between mobile and desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs/quickstart/");
  const nav = page.getByRole("navigation", { name: "Main", exact: true });
  await expect(nav).not.toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(
    nav.getByRole("link", { name: "React API", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(
    nav.getByRole("link", { name: "React API", exact: true }),
  ).toBeVisible();
});

test("documentation search finds a troubleshooting answer", async ({
  page,
}) => {
  await page.goto("/docs/quickstart/");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Search", exact: true })
    .getByRole("textbox", { name: "Search", exact: true })
    .fill("permission denied");
  await expect(page.locator(".pagefind-ui__result-link").first()).toBeVisible();
  await page
    .locator(".pagefind-ui__result-link")
    .filter({ hasText: /Permission|Troubleshooting/i })
    .first()
    .click();
  await expect(page).toHaveURL(/troubleshooting/);
});

test("writing examples preserve separate drafts and expose secondary actions by keyboard", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.copied = text;
        },
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const field = page.getByRole("textbox", { name: "Try voice input" });
  await field.fill("The designs are ready to review.");
  await page.getByRole("tab", { name: "Note", exact: true }).click();
  await expect(field).toHaveValue(
    "Website review\n\nKeep the first release focused.\nNext steps: ",
  );
  await field.fill("Review the new composer on Friday.");
  await page.getByRole("tab", { name: "Note", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(
    page.getByRole("tab", { name: "Message", exact: true }),
  ).toBeFocused();
  await expect(field).toHaveValue("The designs are ready to review.");
  const options = page.getByRole("button", {
    name: "Writing options",
    exact: true,
  });
  await options.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("menuitem", { name: "Copy text", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: "Undo last edit", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute(
    "data-copied",
    "The designs are ready to review.",
  );
  await options.click();
  await page.keyboard.press("Escape");
  await expect(options).toBeFocused();
  await expect(options).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("tab", { name: "Note", exact: true }).click();
  await expect(field).toHaveValue("Review the new composer on Friday.");
  await writingOption(page, "Start over");
  await expect(field).toHaveValue(
    "Website review\n\nKeep the first release focused.\nNext steps: ",
  );
  await page.getByRole("tab", { name: "Message", exact: true }).click();
  await expect(field).toHaveValue("The designs are ready to review.");
  expect(errors).toEqual([]);
});

test("note recording locks scenario switching and preserves native keyboard undo", async ({
  page,
}, testInfo) => {
  await mockDemo(page);
  await page.goto("/");
  await page.getByRole("tab", { name: "Note", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Try voice input" });
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(
    page.getByRole("tab", { name: "Message", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Writing options", exact: true }),
  ).toBeDisabled();
  await expect(field).toHaveValue(/Next steps: The meeting/);
  if (testInfo.project.name === "chromium") {
    await page
      .locator(".hero-demo")
      .screenshot({ path: "../../output/playwright/website-recording.png" });
  }
  await expect(
    page.getByRole("button", { name: "Start recording" }),
  ).toBeVisible({ timeout: 15000 });
  await expect(field).toHaveValue(/Please bring your notes\.$/);
  await field.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(field).toHaveValue(
    "Website review\n\nKeep the first release focused.\nNext steps: The meeting starts at ten.",
  );
  await expect(
    page.getByRole("tab", { name: "Message", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("html")).toHaveAttribute(
    "data-microphone-stopped",
    "true",
  );
});

test("implementation tabs copy their checked source and keep a stable height", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.copied = text;
        },
      },
    });
  });
  await page.goto("/");
  const panel = page.locator(".code-panel");
  const height = (await panel.boundingBox())!.height;
  for (const [label, file] of [
    ["Hook", "hook.tsx"],
    ["VoiceTextarea", "textarea.tsx"],
    ["Next.js", "nextjs.ts"],
    ["Hono", "hono.ts"],
  ]) {
    if (label === "Next.js")
      await page.getByRole("tab", { name: "Server", exact: true }).click();
    await page.getByRole("tab", { name: label, exact: true }).click();
    await expect(panel.locator("pre:visible")).toHaveCount(1);
    await page
      .getByRole("button", { name: `Copy ${label} example`, exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-copied",
      readFileSync(
        new URL(`../src/examples/${file}`, import.meta.url),
        "utf8",
      ).trim(),
    );
    expect(Math.abs((await panel.boundingBox())!.height - height)).toBeLessThan(
      2,
    );
  }
  await page.getByRole("tab", { name: "Server", exact: true }).focus();
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("tab", { name: "Hook", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "VoiceTextarea", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("focused composer and expanded examples are accessible", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Start recording" }),
  ).toBeEnabled();
  await page.getByRole("textbox", { name: "Try voice input" }).focus();
  await expect(
    page.getByRole("textbox", { name: "Try voice input" }),
  ).toBeFocused();
  await expect(page.locator(".composer-editor:visible")).toHaveCSS(
    "box-shadow",
    /4px/,
  );
  if (testInfo.project.name === "chromium")
    await page
      .locator(".hero-demo")
      .screenshot({ path: "../../output/playwright/website-focused.png" });
  await page
    .getByRole("button", { name: "Writing options", exact: true })
    .click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Server", exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("recording feedback preserves layout and locks drafts through finalization", async ({
  page,
}) => {
  await mockDemo(page, {
    permissionDelayMs: 1200,
    connectionDelayMs: 1200,
    finishDelayMs: 1200,
  });
  await page.goto("/");
  const field = page.getByRole("textbox", { name: "Try voice input" });
  const note = page.getByRole("tab", { name: "Note", exact: true });
  const status = page.locator(".demo-status:visible");
  const composer = page.locator(".demo-composer");
  await field.fill("Review the old design.");
  await field.evaluate((node: HTMLTextAreaElement) =>
    node.setSelectionRange(11, 14),
  );
  const initialHeight = (await composer.boundingBox())!.height;
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(status).toContainText("Allow microphone access");
  await expect(note).toBeDisabled();
  await expect(status).toContainText("Connecting to transcription");
  await expect(note).toBeDisabled();
  await expect(status).toContainText("Speak naturally");
  await expect(field).toHaveValue(/Review the The meeting.* design\./);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(status).toContainText("Finishing your transcript");
  await expect(note).toBeDisabled();
  await expect(page.locator("html")).toHaveAttribute(
    "data-microphone-stopped",
    "true",
  );
  expect(
    Math.abs((await composer.boundingBox())!.height - initialHeight),
  ).toBeLessThan(1);
  await expect(
    page.getByRole("button", { name: "Start recording" }),
  ).toBeVisible();
  await expect(note).toBeEnabled();
  await expect(field).not.toHaveValue(/old/);
});
