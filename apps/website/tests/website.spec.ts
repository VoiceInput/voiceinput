import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("simulation edits at the cursor and supports undo without microphone or network", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () => {
        throw new Error("The simulation must not request a microphone");
      },
    });
  });
  const external: string[] = [];
  page.on("request", (request) => {
    if (
      !request.url().startsWith("http://127.0.0.1:4322") &&
      !request.url().startsWith("data:")
    )
      external.push(request.url());
  });
  await page.goto("/");
  const field = page.getByRole("textbox", { name: "Try voice input" });
  await field.scrollIntoViewIfNeeded();
  await expect(field).toBeEditable();
  await field.fill("Before. After.");
  await field.evaluate((node: HTMLTextAreaElement) =>
    node.setSelectionRange(8, 8),
  );
  await page.getByRole("button", { name: "Start demo" }).click();
  await expect(page.getByRole("button", { name: "Start demo" })).toBeVisible({
    timeout: 15000,
  });
  await expect(field).toHaveValue(
    /Before\. Let your ideas do the talking\. Keep your cursor\. Keep your flow\. After\.$/,
  );
  await page.getByRole("button", { name: "Undo last edit" }).click();
  await expect(field).toHaveValue(
    "Before. Let your ideas do the talking. After.",
  );
  await page.getByRole("button", { name: "Undo last edit" }).click();
  await expect(field).toHaveValue("Before. After.");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(field).toHaveValue("A good idea starts here. ");
  expect(external).toEqual([]);
});

test("manual edits during simulation are preserved", async ({ page }) => {
  await page.goto("/#demo");
  const field = page.getByRole("textbox", { name: "Try voice input" });
  await expect(field).toBeEditable();
  await field.fill("Original. ");
  await page.getByRole("button", { name: "Start demo" }).click();
  await expect(field).toHaveValue(/Let your/);
  await expect(field).toBeEditable();
  await field.fill("My correction. ");
  await expect(field).toHaveValue(/My correction\. Keep your cursor/);
  await expect(page.getByRole("button", { name: "Start demo" })).toBeVisible();
  await expect(field).toHaveValue(
    /My correction\. Keep your cursor\. Keep your flow\./,
  );
});

test("accessible homepage and quickstart with real code", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Try voice input" })
    .scrollIntoViewIfNeeded();
  const home = await new AxeBuilder({ page }).analyze();
  expect(home.violations).toEqual([]);
  await page.getByRole("link", { name: "Start building" }).first().click();
  await expect(page).toHaveURL(/\/docs\/quickstart\/?$/);
  await expect(page.locator("article")).toContainText(
    "createOpenAITokenHandler",
  );
  await expect(page.locator("article")).toContainText("@voiceinput/react@next");
  const docs = await new AxeBuilder({ page }).analyze();
  expect(docs.violations).toEqual([]);
});

test("mobile layout, reduced motion and static fallback", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".sculpture-fallback")).toBeVisible();
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
  await page.getByText("Documentation", { exact: true }).click();
  await expect(
    page.getByRole("link", { name: "React API", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("desktop composition and tablet fit", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page
    .locator(".has-webgl")
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  await page.waitForTimeout(3500);
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
    "Voice input.",
  );
  await expect(page.locator(".sculpture-fallback")).toBeVisible();
  await page.getByRole("link", { name: "Start building" }).first().click();
  await expect(page.locator("article")).toContainText(
    "createOpenAITokenHandler",
  );
  await context.close();
});

test("WebGL failure keeps the waveform fallback and demo usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof original>
    ) {
      if (String(args[0]).includes("webgl")) return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto("/");
  await expect(page.locator(".sculpture-fallback")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Try voice input" })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("textbox", { name: "Try voice input" }),
  ).toBeEditable();
  await page.getByRole("button", { name: "Start demo" }).click();
  await expect(page.getByRole("button", { name: "Stop demo" })).toBeVisible();
  await page.getByRole("button", { name: "Stop demo" }).click();
  await expect(page.getByRole("button", { name: "Start demo" })).toBeVisible();
});
