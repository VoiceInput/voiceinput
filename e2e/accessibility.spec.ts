import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

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
  test(`${playground.name} passes axe and keyboard-only voice flows`, async ({
    page,
  }) => {
    await page.goto(playground.url);
    await expect(
      page.getByRole("heading", { name: "Voice Lab" }),
    ).toBeVisible();
    await expectNoAxeViolations(page);

    const field = page.getByRole("textbox", {
      name: "Controlled textarea",
      exact: true,
    });
    await tabTo(page, field);
    await expect(field).toBeFocused();

    const toggle = page.getByRole("button", {
      name: "Toggle dictation for Controlled textarea",
      exact: true,
    });
    await tabTo(page, toggle);
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(fieldStatus(page, "listening")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).toBeFocused();
    await expect(fieldStatus(page, "idle")).toBeVisible();

    await page.goto(playground.url);
    const holdMode = page.getByRole("button", { name: "Hold", exact: true });
    await tabTo(page, holdMode);
    await page.keyboard.press("Space");
    await expect(holdMode).toHaveAttribute("aria-pressed", "true");

    const hold = page.getByRole("button", {
      name: "Hold to dictate into Controlled textarea",
      exact: true,
    });
    await tabTo(page, hold);
    await page.keyboard.down("Space");
    await expect(hold).toHaveAttribute("aria-pressed", "true");
    await expect(fieldStatus(page, "listening")).toBeVisible();
    await page.keyboard.up("Space");
    await expect(hold).toHaveAttribute("aria-pressed", "false");
    await expect(hold).toBeFocused();
    await expect(fieldStatus(page, "idle")).toBeVisible();

    const tokenError = page.getByRole("button", {
      name: "Token error",
      exact: true,
    });
    await tabTo(page, tokenError);
    await page.keyboard.press("Enter");
    await expect(tokenError).toBeFocused();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Synthetic token request failed" }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

function fieldStatus(page: Page, status: "idle" | "listening") {
  return page
    .getByRole("textbox", {
      name: "Controlled textarea",
      exact: true,
    })
    .locator("..")
    .getByText(status, { exact: true });
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target.join(" ")),
    })),
  ).toEqual([]);
}

async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error("Target was not reachable within 60 Tab presses.");
}
