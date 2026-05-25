import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

type ColorTarget = {
  name: string;
  rgb: [number, number, number];
  tolerance: number;
  minPixels: number;
};

const PIXI_COLOR_TARGETS: ColorTarget[] = [
  { name: "library background", rgb: [0x1f, 0x36, 0x2f], tolerance: 2, minPixels: 200_000 },
  { name: "central desk", rgb: [0x6a, 0x50, 0x35], tolerance: 5, minPixels: 8_000 },
  { name: "Luma sprite", rgb: [0xf2, 0xc6, 0x6d], tolerance: 10, minPixels: 50 },
  { name: "Orion sprite", rgb: [0x6c, 0xa7, 0xbd], tolerance: 10, minPixels: 50 },
  { name: "Neria sprite", rgb: [0x8f, 0xa7, 0x65], tolerance: 10, minPixels: 50 },
  { name: "Quill sprite", rgb: [0xb9, 0x91, 0xc8], tolerance: 10, minPixels: 50 },
  { name: "Argus sprite", rgb: [0xbd, 0x80, 0x6e], tolerance: 10, minPixels: 50 },
];

const EXPECTED_TIMELINE_MESSAGES = [
  "Draft a focused project plan",
  "Luma is arranging the reading lamps",
  "Luma sends Orion and Neria into the stacks",
  "Orion studies the star maps for useful references",
  "Orion returns with a concise research brief",
  "Neria checks the archive for stable preferences",
  "Neria finds relevant memory notes",
  "Argus checks the answer for risk and gaps",
  "Orion returns to the star-map balcony",
  "Neria closes the archive ledger",
  "Argus lowers the review lantern",
  "Luma places the final summary on the central desk",
];

function inspectScenePixels(buffer: Buffer) {
  const image = PNG.sync.read(buffer);
  const colorCounts = Object.fromEntries(PIXI_COLOR_TARGETS.map((target) => [target.name, 0]));

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (image.width * y + x) * 4;
      const alpha = image.data[offset + 3];
      const red = image.data[offset];
      const green = image.data[offset + 1];
      const blue = image.data[offset + 2];

      if (alpha === 0) {
        continue;
      }

      for (const target of PIXI_COLOR_TARGETS) {
        if (
          Math.abs(red - target.rgb[0]) <= target.tolerance &&
          Math.abs(green - target.rgb[1]) <= target.tolerance &&
          Math.abs(blue - target.rgb[2]) <= target.tolerance
        ) {
          colorCounts[target.name] += 1;
        }
      }
    }
  }

  return colorCounts;
}

test("renders a nonblank Pixi scene and completes a mock agent run", async ({ page }) => {
  await page.goto("/");

  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();

  const initialScene = inspectScenePixels(await canvas.screenshot());
  for (const target of PIXI_COLOR_TARGETS) {
    expect(initialScene[target.name], `${target.name} pixel count`).toBeGreaterThan(target.minPixels);
  }

  await page.getByLabel("Task request").fill("Draft a focused project plan");
  await page.getByRole("button", { name: "Send to Luma" }).click();

  await expect(page.getByText("Luma places the final summary on the central desk")).toBeVisible();
  await expect(page.getByText("Orion returns to the star-map balcony")).toBeVisible();
  await expect(page.getByText("Neria closes the archive ledger")).toBeVisible();
  await expect(page.getByText("Argus lowers the review lantern")).toBeVisible();

  const timelineMessages = page.locator(".timeline li span:last-child");
  await expect(timelineMessages).toHaveText(EXPECTED_TIMELINE_MESSAGES);

  await expect(page.locator(".agent-card", { hasText: "Luma" }).locator("strong")).toHaveText("done");
  await expect(page.locator(".agent-card", { hasText: "Orion" }).locator("strong")).toHaveText("done");
  await expect(page.locator(".agent-card", { hasText: "Neria" }).locator("strong")).toHaveText("done");
  await expect(page.locator(".agent-card", { hasText: "Argus" }).locator("strong")).toHaveText("done");
  await expect(page.locator(".agent-card", { hasText: "Quill" }).locator("strong")).toHaveText("idle");

  const finalScene = inspectScenePixels(await canvas.screenshot());
  for (const target of PIXI_COLOR_TARGETS) {
    expect(finalScene[target.name], `final ${target.name} pixel count`).toBeGreaterThan(target.minPixels);
  }

  await expect(page).toHaveScreenshot("lanternwood-dashboard.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.005,
  });
});
