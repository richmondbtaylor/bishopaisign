/**
 * Playwright smoke test: signature field overlays + inline validation on mobile.
 *
 * Run with a live signing URL:
 *   TEST_SIGN_URL="https://bishopaisign.lovable.app/sign/<docId>?token=<token>" \
 *     npx playwright test tests/e2e/sign-overlays.spec.ts
 *
 * Verifies:
 *  1. Field overlays render without any pulsing/flashing animation.
 *  2. Opening the signature dialog and submitting an invalid (single-word)
 *     name surfaces the inline validation message with proper ARIA wiring
 *     on a 375px-wide mobile viewport.
 */
import { test, expect, devices } from "@playwright/test";

const SIGN_URL = process.env.TEST_SIGN_URL;

test.use({ ...devices["iPhone 12"] });

test.describe("SignDocument mobile smoke", () => {
  test.skip(!SIGN_URL, "Set TEST_SIGN_URL to a valid signing link to run.");

  test("field overlays render without flicker and validation blocks bad names", async ({ page }) => {
    await page.goto(SIGN_URL!, { waitUntil: "networkidle" });

    // Wait for at least one interactive field overlay to mount.
    const overlay = page.locator('[data-field-overlay="true"], button:has-text("Click to sign"), button:has-text("Click for date")').first();
    await expect(overlay).toBeVisible({ timeout: 15_000 });

    // 1) No CSS animation should be running on the overlay (no pulse/flicker).
    const anim = await overlay.evaluate((el) => {
      const cs = getComputedStyle(el as HTMLElement);
      return {
        animationName: cs.animationName,
        animationDuration: cs.animationDuration,
        transition: cs.transitionProperty,
      };
    });
    expect(anim.animationName === "none" || anim.animationDuration === "0s").toBeTruthy();
    expect(anim.transition).not.toMatch(/color|background|all/);

    // Sample opacity across ~1s to ensure it does not oscillate (flash detector).
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      samples.push(await overlay.evaluate((el) => parseFloat(getComputedStyle(el as HTMLElement).opacity)));
      await page.waitForTimeout(100);
    }
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    expect(max - min).toBeLessThan(0.05); // no visible flicker

    // 2) Open signature dialog and test inline validation.
    const signBtn = page.getByRole("button", { name: /click to sign/i }).first();
    await signBtn.tap();

    const nameInput = page.getByLabel(/full legal name/i);
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveAttribute("aria-required", "true");

    // Enter a single name -> should be rejected on adopt.
    await nameInput.fill("Jane");
    await page.getByRole("button", { name: /adopt & place/i }).tap();

    const err = page.locator("#sig-name-error");
    await expect(err).toBeVisible();
    await expect(err).toHaveAttribute("role", "alert");
    await expect(err).toContainText(/first.*last/i);
    await expect(nameInput).toHaveAttribute("aria-invalid", "true");
    await expect(nameInput).toHaveAttribute("aria-describedby", /sig-name-error/);

    // Typing again clears the error (aria-invalid flips off).
    await nameInput.fill("Jane Smith");
    await expect(nameInput).toHaveAttribute("aria-invalid", "false");

    // Live preview reflects the typed name.
    const preview = page.locator('[aria-labelledby="sig-preview-label"]');
    await expect(preview).toContainText("Jane Smith");
    await expect(preview).toHaveAttribute("aria-live", "polite");
  });
});
