import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium, expect as baseExpect } from "@playwright/test";

const base = process.env.TEST_URL ?? "http://localhost:3084";
const screenshots = process.env.SCREENSHOT_DIR ?? "/tmp/ofek324-branding";
const expect = baseExpect.configure({ timeout: 30000 });
const browser = await chromium.launch();

try {
  await mkdir(screenshots, { recursive: true });
  const page = await browser.newPage();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const brand = page.getByRole("link", { name: "אופק 324 — הבית", exact: true });
    const logo = brand.getByRole("img", { name: "סמל יחידת אופק 324", exact: true });
    await expect(logo).toBeVisible();
    await expect.poll(() => logo.evaluate(image => image.complete && image.naturalWidth === 256 && image.naturalHeight === 256)).toBe(true);
    const box = await logo.boundingBox();
    assert.ok(box);
    assert.equal(box.width, 48);
    assert.equal(box.height, 48);
    assert.equal(await logo.evaluate(image => getComputedStyle(image).transform), "none");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `page overflow at ${width}px`);
    await expect(page.locator("footer").getByRole("link", { name: "דובר צה״ל", exact: true }))
      .toHaveAttribute("href", "https://commons.wikimedia.org/wiki/File:OfekUnit.png");
    await expect(page.locator("footer").getByRole("link", { name: "CC BY-SA 3.0", exact: true }))
      .toHaveAttribute("href", "https://creativecommons.org/licenses/by-sa/3.0/");
    await page.screenshot({ path: `${screenshots}/landing-${width}.png`, fullPage: true });
  }

  const logoResponse = await page.request.get(new URL("/ofek-unit.png", base).href);
  assert.equal(logoResponse.status(), 200);
  assert.deepEqual(await logoResponse.body(), await readFile(new URL("../public/ofek-unit.png", import.meta.url)));
  const iconHref = await page.locator('link[rel="icon"]').first().getAttribute("href");
  assert.ok(iconHref);
  const iconResponse = await page.request.get(new URL(iconHref, base).href);
  assert.equal(iconResponse.status(), 200);
  assert.deepEqual(await iconResponse.body(), await readFile(new URL("../src/app/favicon.ico", import.meta.url)));

  await page.goto(new URL("/login", base).href);
  await expect(page.getByRole("img", { name: "סמל יחידת אופק 324", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "אופק 324 — הבית", exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/");
  console.log("PASS logo at desktop and mobile widths, RTL, attribution, exact image/favicon bytes, and home navigation");
} finally {
  await browser.close();
}
