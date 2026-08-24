import { expect, test, type Page } from "@playwright/test";

const playgrounds = [
  {
    name: "Next.js App Router",
    url: "http://127.0.0.1:3000",
  },
  {
    name: "Vite + Hono",
    url: "http://127.0.0.1:5173",
  },
] as const;

for (const playground of playgrounds) {
  test.describe(playground.name, () => {
    test("runs deterministic auth, interim, and final flows", async ({
      page,
    }) => {
      const pageErrors = capturePageErrors(page);
      await page.goto(playground.url);

      await expect(
        page.getByRole("heading", { name: "Voice Lab" }),
      ).toBeVisible();
      await expect(
        page.getByText(playground.name, { exact: true }),
      ).toBeVisible();

      await page.getByRole("button", { name: "Issue local session" }).click();
      await expect(
        page.getByText("auth: login", { exact: true }),
      ).toBeVisible();

      const field = page.getByRole("textbox", {
        name: "Controlled textarea",
        exact: true,
      });
      await page.getByRole("button", { name: "Select phrase" }).click();
      await page.getByRole("button", { name: "Start active" }).click();
      await expect(
        field.locator("..").getByText("listening", { exact: true }),
      ).toBeVisible();

      await page.getByRole("button", { name: "Revise interim" }).click();
      await expect(field).toHaveValue(/hello/u);

      await page.getByRole("button", { name: "Emit final" }).click();
      await expect(field).toHaveValue(/hello from VoiceInput/u);
      await expect(
        page.getByText("audio-received", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText('{"chunks":1}', { exact: true }),
      ).toBeVisible();
      await expect(
        field.locator("..").getByText("idle", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("final", { exact: true })).toBeVisible();
      expect(pageErrors).toEqual([]);
    });

    test("surfaces deterministic connection failures and recovers", async ({
      page,
    }) => {
      const pageErrors = capturePageErrors(page);
      await page.goto(playground.url);

      await page.getByRole("button", { name: "Connection error" }).click();
      await expect(
        page.getByText("network-error: Synthetic connection failure.", {
          exact: true,
        }),
      ).toBeVisible();

      await page.getByRole("button", { name: "Start active" }).click();
      await expect(
        page
          .getByRole("textbox", {
            name: "Controlled textarea",
            exact: true,
          })
          .locator("..")
          .getByText("listening", {
            exact: true,
          }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Cancel active" }).click();
      await expect(page.getByText("cancel", { exact: true })).toBeVisible();
      expect(pageErrors).toEqual([]);
    });
  });
}

function capturePageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}
