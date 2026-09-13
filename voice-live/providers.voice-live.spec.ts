import { expect, test, type Locator, type Page } from "@playwright/test";

const providers = [
  { name: "OpenAI", value: "openai" },
  { name: "Deepgram", value: "deepgram" },
  { name: "ElevenLabs", value: "elevenlabs" },
] as const;

for (const provider of providers) {
  test(`${provider.name} transcribes two stopped recordings without duplicates`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.name));

    await page.goto("/");
    await expect(page.getByText("auth: login", { exact: true })).toBeVisible();
    await page
      .locator('aside[aria-label="Lab configuration"] select')
      .first()
      .selectOption(provider.value);

    const field = page.getByRole("textbox", {
      name: "Controlled textarea",
      exact: true,
    });
    await page.getByRole("button", { name: "Clear active text" }).click();

    const first = await recordOnce(page, field);
    await page.getByRole("button", { name: "Clear events" }).click();
    await page.getByRole("button", { name: "Clear active text" }).click();
    await expect(field).toHaveValue("");
    const second = await recordOnce(page, field);

    expectTranscript(first);
    expectTranscript(second);
    expect(hasDuplicateAnchor(first)).toBe(false);
    expect(hasDuplicateAnchor(second)).toBe(false);
    expect(pageErrors).toEqual([]);
  });
}

async function recordOnce(page: Page, field: Locator): Promise<string> {
  const eventLog = page.getByRole("region", {
    name: "Normalized event stream",
  });
  await field.focus();
  await page.getByRole("button", { name: "Start active" }).click();
  await expect(
    field.locator("..").getByText("listening", { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(7_000);
  await page.getByRole("button", { name: "Stop active" }).click();
  await expect(
    field.locator("..").getByText("idle", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  const finalEvents = eventLog.getByText("final", { exact: true });
  const userStops = eventLog.getByText('{"reason":"user"}', { exact: true });
  await waitForLiveCondition(
    async () => (await userStops.count()) > 0,
    "application",
    "missing-user-stop",
  );
  requireLiveCondition(
    (await finalEvents.count()) > 0,
    "provider",
    "missing-final-event",
  );
  requireLiveCondition(
    (await eventLog.getByText("error", { exact: true }).count()) === 0,
    "provider",
    "stop-emitted-error",
  );
  requireLiveCondition(
    (await eventLog
      .getByText('{"reason":"finalization-timeout"}', {
        exact: true,
      })
      .count()) === 0,
    "provider",
    "finalization-timeout",
  );
  requireLiveCondition(
    (await field.locator("..").getByRole("alert").count()) === 0,
    "application",
    "field-alert-after-stop",
  );
  await expect
    .poll(async () => normalize(await field.inputValue()).length, {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
  return await field.inputValue();
}

function expectTranscript(value: string): void {
  requireLiveCondition(
    /\b(harry|quilter)\b/u.test(normalize(value)),
    "provider",
    "phrase-not-recognized",
  );
}

function requireLiveCondition(
  condition: boolean,
  category: "application" | "provider",
  code: string,
): asserts condition {
  if (!condition) throw new Error(`[voice-live:${category}] ${code}`);
}

async function waitForLiveCondition(
  condition: () => Promise<boolean>,
  category: "application" | "provider",
  code: string,
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`[voice-live:${category}] ${code}`);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function hasDuplicateAnchor(value: string): boolean {
  const words = normalize(value).split(" ").filter(Boolean);
  return (
    words.filter((word) => word === "harry").length > 1 ||
    words.filter((word) => word === "quilter").length > 1
  );
}
