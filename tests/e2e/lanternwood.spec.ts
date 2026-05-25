import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

type ColorTarget = {
  name: string;
  rgb: [number, number, number];
  tolerance: number;
  minPixels: number;
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

const PIXI_SCENE_SIZE = {
  width: 960,
  height: 620,
};

const PIXI_COLOR_TARGETS: ColorTarget[] = [
  { name: "library wall", rgb: [0x1f, 0x36, 0x2f], tolerance: 3, minPixels: 60_000 },
  { name: "upper wall", rgb: [0x18, 0x26, 0x2f], tolerance: 8, minPixels: 25_000 },
  { name: "central desk", rgb: [0x6a, 0x50, 0x35], tolerance: 6, minPixels: 3_500 },
  { name: "Luma robe", rgb: [0xf2, 0xc6, 0x6d], tolerance: 20, minPixels: 500, region: { x: 456, y: 238, width: 48, height: 60 } },
  { name: "Orion robe", rgb: [0x6c, 0xa7, 0xbd], tolerance: 20, minPixels: 500, region: { x: 196, y: 148, width: 48, height: 60 } },
  { name: "Neria robe", rgb: [0x8f, 0xa7, 0x65], tolerance: 20, minPixels: 500, region: { x: 236, y: 408, width: 48, height: 60 } },
  { name: "Quill robe", rgb: [0xb9, 0x91, 0xc8], tolerance: 20, minPixels: 500, region: { x: 676, y: 408, width: 48, height: 60 } },
  { name: "Argus robe", rgb: [0xbd, 0x80, 0x6e], tolerance: 20, minPixels: 500, region: { x: 716, y: 158, width: 48, height: 60 } },
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

  for (const target of PIXI_COLOR_TARGETS) {
    const xScale = image.width / PIXI_SCENE_SIZE.width;
    const yScale = image.height / PIXI_SCENE_SIZE.height;
    const region = target.region ?? { x: 0, y: 0, width: PIXI_SCENE_SIZE.width, height: PIXI_SCENE_SIZE.height };
    const startX = Math.max(0, Math.floor(region.x * xScale));
    const startY = Math.max(0, Math.floor(region.y * yScale));
    const endX = Math.min(image.width, Math.ceil((region.x + region.width) * xScale));
    const endY = Math.min(image.height, Math.ceil((region.y + region.height) * yScale));

    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const offset = (image.width * y + x) * 4;
        const alpha = image.data[offset + 3];
        const red = image.data[offset];
        const green = image.data[offset + 1];
        const blue = image.data[offset + 2];

        if (alpha === 0) {
          continue;
        }

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

function countDifferentPixels(firstBuffer: Buffer, secondBuffer: Buffer) {
  const first = PNG.sync.read(firstBuffer);
  const second = PNG.sync.read(secondBuffer);
  const width = Math.min(first.width, second.width);
  const height = Math.min(first.height, second.height);
  let differentPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const firstOffset = (first.width * y + x) * 4;
      const secondOffset = (second.width * y + x) * 4;
      const channelDelta =
        Math.abs(first.data[firstOffset] - second.data[secondOffset]) +
        Math.abs(first.data[firstOffset + 1] - second.data[secondOffset + 1]) +
        Math.abs(first.data[firstOffset + 2] - second.data[secondOffset + 2]) +
        Math.abs(first.data[firstOffset + 3] - second.data[secondOffset + 3]);

      if (channelDelta > 40) {
        differentPixels += 1;
      }
    }
  }

  return differentPixels;
}

test("renders a nonblank Pixi scene and completes a mock agent run", async ({ page }) => {
  await page.goto("/");

  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  const frame = page.locator(".scene-frame");
  const frameBox = await frame.boundingBox();
  const canvasBox = await canvas.boundingBox();

  expect(frameBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect(canvasBox!.width).toBeLessThanOrEqual(frameBox!.width + 1);
  expect(canvasBox!.height).toBeLessThanOrEqual(frameBox!.height + 1);

  const initialScene = inspectScenePixels(await canvas.screenshot());
  for (const target of PIXI_COLOR_TARGETS) {
    expect(initialScene[target.name], `${target.name} pixel count`).toBeGreaterThan(target.minPixels);
  }

  await page.getByLabel("Task request").fill("Draft a focused project plan");
  await page.getByRole("button", { name: "Send to Luma" }).click();

  await expect(page.getByText("Orion studies the star maps for useful references")).toBeVisible();
  const activeFrameBefore = await canvas.screenshot();
  await page.waitForTimeout(350);
  const activeFrameAfter = await canvas.screenshot();
  expect(countDifferentPixels(activeFrameBefore, activeFrameAfter), "active animation pixel delta").toBeGreaterThan(500);

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

  await page.evaluate(() => {
    (window as Window & { __LANTERNWOOD_FREEZE_ANIMATION__?: boolean }).__LANTERNWOOD_FREEZE_ANIMATION__ = true;
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

  const finalScene = inspectScenePixels(await canvas.screenshot());
  for (const target of PIXI_COLOR_TARGETS) {
    expect(finalScene[target.name], `final ${target.name} pixel count`).toBeGreaterThan(target.minPixels);
  }

  await expect(page).toHaveScreenshot("lanternwood-dashboard.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.005,
  });
});

test("fits the Pixi scene inside the visible frame on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const frameBox = await page.locator(".scene-frame").boundingBox();
  const canvasBox = await page.locator("canvas").boundingBox();

  expect(frameBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect(canvasBox!.width).toBeLessThanOrEqual(frameBox!.width + 1);
  expect(canvasBox!.height).toBeLessThanOrEqual(frameBox!.height + 1);
});
