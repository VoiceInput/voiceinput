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

    test("covers stop, cancel, token, disconnect, and retry semantics", async ({
      page,
    }) => {
      const pageErrors = capturePageErrors(page);
      await page.goto(playground.url);

      await page.getByRole("button", { name: "Token error" }).click();
      await expect(
        page.getByText("token-error: Synthetic token request failed.", {
          exact: true,
        }),
      ).toBeVisible();

      await page.getByRole("button", { name: "Start active" }).click();
      await expect(activeFieldStatus(page, "listening")).toBeVisible();
      await page.getByRole("button", { name: "Disconnect active" }).click();
      await expect(
        page.getByText("network-error: Synthetic provider disconnected.", {
          exact: true,
        }),
      ).toBeVisible();

      await page.getByRole("button", { name: "Connection error" }).click();
      await expect(
        page.getByText("network-error: Synthetic connection failure.", {
          exact: true,
        }),
      ).toBeVisible();

      await page.getByRole("button", { name: "Start active" }).click();
      await expect(activeFieldStatus(page, "listening")).toBeVisible();
      await page.getByRole("button", { name: "Stop active" }).click();
      await expect(activeFieldStatus(page, "idle")).toBeVisible();
      await expect(page.getByText("stop", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Start active" }).click();
      await expect(activeFieldStatus(page, "listening")).toBeVisible();
      await page.getByRole("button", { name: "Cancel active" }).click();
      await expect(page.getByText("cancel", { exact: true })).toBeVisible();
      expect(pageErrors).toEqual([]);
    });

    test("preserves edits across controlled, uncontrolled, and switched fields", async ({
      page,
    }) => {
      const pageErrors = capturePageErrors(page);
      await page.goto(playground.url);

      for (const field of [
        {
          picker: "A / controlled",
          label: "Controlled textarea",
          kind: "controlled",
        },
        {
          picker: "B / uncontrolled",
          label: "Uncontrolled textarea",
          kind: "uncontrolled",
        },
      ]) {
        await page.getByRole("button", { name: field.picker }).click();
        const textarea = page.getByRole("textbox", {
          name: field.label,
          exact: true,
        });
        await page.getByRole("button", { name: "Select phrase" }).click();
        await page.getByRole("button", { name: "Start active" }).click();
        await expect(
          textarea.locator("..").getByText("listening", { exact: true }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Revise interim" }).click();
        await expect(textarea).toHaveValue(/hello/u);
        await textarea.evaluate((node) => {
          const target = node as HTMLTextAreaElement;
          const position = target.value.indexOf("hello") + "hello".length;
          target.focus();
          target.setSelectionRange(position, position);
          target.dispatchEvent(new Event("select", { bubbles: true }));
        });
        await textarea.pressSequentially(" [manual edit]");
        await page.getByRole("button", { name: "Emit final" }).click();
        await expect(textarea).toHaveValue(
          `This is the ${field.kind} field. hello [manual edit], move the caret, or type while dictating.`,
        );
      }

      await page.getByRole("button", { name: "A / controlled" }).click();
      await page.getByRole("button", { name: "Start active" }).click();
      await page.getByRole("button", { name: "Run contention" }).click();
      await expect(
        page
          .getByRole("textbox", {
            name: "Controlled textarea",
            exact: true,
          })
          .locator("..")
          .getByText("idle", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText('{"reason":"replaced"}', { exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("textbox", {
            name: "Uncontrolled textarea",
            exact: true,
          })
          .locator("..")
          .getByText("listening", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Cancel active" }).click();
      expect(pageErrors).toEqual([]);
    });
  });
}

function activeFieldStatus(page: Page, status: "idle" | "listening") {
  return page
    .getByRole("textbox", {
      name: "Controlled textarea",
      exact: true,
    })
    .locator("..")
    .getByText(status, { exact: true });
}

function capturePageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}
