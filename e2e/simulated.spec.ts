import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("http://127.0.0.1:5174");
});

test("dictation cooperates with typing and real keyboard undo/redo", async ({
  page,
}) => {
  const field = page.getByLabel("Message", { exact: true });
  await field.fill("Typed");
  await page.getByRole("button", { name: "Speak", exact: true }).click();
  await expect(field).toHaveValue("Typed Hello from VoiceInput.");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await field.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(field).toHaveValue("Typed");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(field).toHaveValue("Typed Hello from VoiceInput.");
});

test("React Hook Form observes validation, dirty state, submission, reset, and disabled state", async ({
  page,
}) => {
  const field = page.getByLabel("Support message", { exact: true });
  await field.fill("a");
  await expect(page.getByRole("alert")).toHaveText(
    "Use at least five characters",
  );
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(field).toHaveValue("");
  await expect(page.getByTestId("dirty")).toHaveText("Unchanged");
  await page
    .getByRole("button", { name: "Start voice input", exact: true })
    .click();
  await expect(field).toHaveValue("Hello from VoiceInput.");
  await page
    .getByRole("button", { name: "Stop voice input", exact: true })
    .click();
  await expect(page.getByTestId("dirty")).toHaveText("Edited");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByLabel("Submitted message")).toHaveText(
    "Hello from VoiceInput.",
  );
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(field).toHaveValue("");
  await page.getByLabel("Disable field").check();
  await expect(field).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Start voice input", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Disable field").uncheck();
  await expect(field).toBeEnabled();
});
