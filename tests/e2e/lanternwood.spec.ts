import { expect, test, type Locator, type Page } from "@playwright/test";
import { PNG } from "pngjs";

type DebugAgentState = {
  status: string;
  x: number;
  y: number;
  zIndex: number;
};

type DebugBubble = {
  expiresIn: number;
  lifetime: number;
  owner: string;
  text: string;
  x: number;
  y: number;
};

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
  { name: "library wall", rgb: [0x1f, 0x36, 0x2f], tolerance: 3, minPixels: 15_000 },
  { name: "upper wall", rgb: [0x18, 0x26, 0x2f], tolerance: 8, minPixels: 25_000 },
  { name: "central desk", rgb: [0x6a, 0x50, 0x35], tolerance: 6, minPixels: 2_500 },
  { name: "Luma robe", rgb: [0xf2, 0xc6, 0x6d], tolerance: 20, minPixels: 100, region: { x: 456, y: 238, width: 60, height: 80 } },
  { name: "Orion robe", rgb: [0x6c, 0xa7, 0xbd], tolerance: 24, minPixels: 70, region: { x: 190, y: 138, width: 70, height: 82 } },
  { name: "Neria robe", rgb: [0x8f, 0xa7, 0x65], tolerance: 24, minPixels: 70, region: { x: 230, y: 398, width: 70, height: 82 } },
  { name: "Quill robe", rgb: [0xb9, 0x91, 0xc8], tolerance: 24, minPixels: 70, region: { x: 670, y: 398, width: 70, height: 82 } },
  { name: "Argus robe", rgb: [0xbd, 0x80, 0x6e], tolerance: 24, minPixels: 70, region: { x: 710, y: 148, width: 70, height: 82 } },
];

test.setTimeout(120_000);

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

        if (
          alpha > 0 &&
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

async function readDebugAgent(page: Page, agentId: string) {
  return page.evaluate(
    (id) => (window as Window & { __LANTERNWOOD_DEBUG_AGENTS__?: Record<string, DebugAgentState> }).__LANTERNWOOD_DEBUG_AGENTS__?.[id],
    agentId,
  );
}

async function readDebugBubbleHistory(page: Page) {
  return page.evaluate(
    () => (window as Window & { __LANTERNWOOD_DEBUG_BUBBLE_HISTORY__?: Array<Pick<DebugBubble, "lifetime" | "owner" | "text">> }).__LANTERNWOOD_DEBUG_BUBBLE_HISTORY__ ?? [],
  );
}

async function readDebugBubbles(page: Page) {
  return page.evaluate(
    () => (window as Window & { __LANTERNWOOD_DEBUG_BUBBLES__?: DebugBubble[] }).__LANTERNWOOD_DEBUG_BUBBLES__ ?? [],
  );
}

async function expectNoHorizontalOverflow(page: Page, width: number) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

async function assertCanvasFitsFrame(canvas: Locator, frame: Locator) {
  const frameBox = await frame.boundingBox();
  const canvasBox = await canvas.boundingBox();

  expect(frameBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect(canvasBox!.width).toBeLessThanOrEqual(frameBox!.width + 1);
  expect(canvasBox!.height).toBeLessThanOrEqual(frameBox!.height + 1);
}

test("renders a nonblank scene, completes mock flow, bubbles dispatch/report, and opens drawer details", async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { __LANTERNWOOD_EVENT_DELAY_MS__?: number }).__LANTERNWOOD_EVENT_DELAY_MS__ = 800;
  });
  await page.goto("/");

  const canvas = page.locator("canvas");
  const frame = page.locator(".scene-frame");
  await expect(canvas).toBeVisible();
  await assertCanvasFitsFrame(canvas, frame);
  await expect(page.getByRole("region", { name: "Event timeline" })).toHaveCount(0);

  const initialScene = inspectScenePixels(await canvas.screenshot());
  for (const target of PIXI_COLOR_TARGETS) {
    expect(initialScene[target.name], `${target.name} pixel count`).toBeGreaterThan(target.minPixels);
  }

  const initialLuma = await readDebugAgent(page, "luma");
  expect(initialLuma).toBeDefined();

  await page.getByLabel("Task request").fill("Review this code and verify risky edge cases");
  await page.getByRole("button", { name: "Send to Luma" }).click();

  await expect.poll(async () => (await readDebugBubbleHistory(page)).map((bubble) => bubble.text).join("\n")).toContain("Orion");
  await expect.poll(async () => (await readDebugAgent(page, "luma"))?.x ?? 999).toBeLessThan(initialLuma!.x);
  await expect
    .poll(async () => (await readDebugBubbleHistory(page)).some((bubble) => /Research brief|Memory note|Draft note|Review note/.test(bubble.text)))
    .toBe(true);
  const promptBubble = (await readDebugBubbleHistory(page)).find((bubble) => bubble.text.includes("Orion"));
  expect(promptBubble?.owner).toBe("luma");
  expect(promptBubble?.lifetime).toBeGreaterThanOrEqual(2.1);
  expect(promptBubble?.lifetime).toBeLessThanOrEqual(2.3);

  await expect(page.getByRole("button", { name: "Open full final output" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Final output" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Routing decision" })).toContainText("Luma selected: Orion, Argus");
  await expect(page.getByRole("region", { name: "Routing decision" })).toContainText("Skipped: Neria, Quill");
  await expect(page.getByLabel("Agents summary")).toContainText("Argus: done");

  await page.evaluate(() => {
    (window as Window & { __LANTERNWOOD_FREEZE_ANIMATION__?: boolean }).__LANTERNWOOD_FREEZE_ANIMATION__ = true;
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

  const argus = await readDebugAgent(page, "argus");
  const quill = await readDebugAgent(page, "quill");
  expect(argus?.zIndex).toBeLessThan(quill!.zIndex);

  const frozenScene = inspectScenePixels(await canvas.screenshot());
  for (const target of PIXI_COLOR_TARGETS.filter((item) => item.region)) {
    expect(frozenScene[target.name], `${target.name} frozen pixel count`).toBeGreaterThan(target.minPixels);
  }

  await page.getByRole("button", { name: "Open full final output" }).click();
  await expect(page.getByRole("dialog", { name: "Run details" })).toContainText(
    "Here is the focused plan synthesized from Orion and Argus.",
  );
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Open run log" }).click();
  await page.getByRole("tab", { name: "Routing" }).click();
  await expect(page.getByRole("dialog", { name: "Run details" })).toContainText("Selected agents: Orion, Argus");
  await page.getByRole("tab", { name: "Run log" }).click();
  await expect(page.getByRole("dialog", { name: "Run details" })).toContainText("Luma -> Orion");
  await expect(page.getByRole("dialog", { name: "Run details" })).toContainText("Orion report: Research brief");
  await page.getByRole("button", { name: "Close" }).click();

  await page.evaluate(() => {
    (window as Window & { __LANTERNWOOD_FREEZE_ANIMATION__?: boolean }).__LANTERNWOOD_FREEZE_ANIMATION__ = false;
  });
  await expect.poll(async () => (await readDebugBubbles(page)).length).toBe(0);

  await expect(page).toHaveScreenshot("lanternwood-dashboard.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.005,
  });

  await page.getByLabel("Task request").fill("Review another code path and verify risky edge cases");
  await page.getByRole("button", { name: "Send to Luma" }).click();
  await expect.poll(async () => (await readDebugBubbleHistory(page)).length).toBe(0);
  await expect.poll(async () => (await readDebugBubbleHistory(page)).map((bubble) => bubble.text).join("\n")).toContain("Orion");
});

test("keeps the layout stable on mobile without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await assertCanvasFitsFrame(page.locator("canvas"), page.locator(".scene-frame"));
  await expectNoHorizontalOverflow(page, 390);
});

test("places the inspector beside the scene on wide screens without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 900 });
  await page.goto("/");

  const stageBox = await page.locator(".library-stage").boundingBox();
  const sceneBox = await page.locator(".scene-frame").boundingBox();
  const inspectorBox = await page.locator(".live-run-inspector").boundingBox();

  expect(stageBox).not.toBeNull();
  expect(sceneBox).not.toBeNull();
  expect(inspectorBox).not.toBeNull();
  expect(inspectorBox!.x).toBeGreaterThan(sceneBox!.x + sceneBox!.width);
  await expect(page.locator(".final-output-panel")).toHaveCount(0);
  await expectNoHorizontalOverflow(page, 1700);
});
