import { expect, test, type Locator, type Page } from "@playwright/test";
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

type DebugAgentState = {
  status: string;
  x: number;
  y: number;
};

type VisualColorProbe = {
  rgb: [number, number, number];
  tolerance: number;
};

const PIXI_SCENE_SIZE = {
  width: 960,
  height: 620,
};

const PIXI_COLOR_TARGETS: ColorTarget[] = [
  { name: "library wall", rgb: [0x1f, 0x36, 0x2f], tolerance: 3, minPixels: 15_000 },
  { name: "upper wall", rgb: [0x18, 0x26, 0x2f], tolerance: 8, minPixels: 25_000 },
  { name: "central desk", rgb: [0x6a, 0x50, 0x35], tolerance: 6, minPixels: 2_500 },
  { name: "Luma robe", rgb: [0xf2, 0xc6, 0x6d], tolerance: 20, minPixels: 150, region: { x: 456, y: 238, width: 48, height: 60 } },
  { name: "Orion robe", rgb: [0x6c, 0xa7, 0xbd], tolerance: 20, minPixels: 150, region: { x: 196, y: 148, width: 48, height: 60 } },
  { name: "Neria robe", rgb: [0x8f, 0xa7, 0x65], tolerance: 20, minPixels: 150, region: { x: 236, y: 408, width: 48, height: 60 } },
  { name: "Quill robe", rgb: [0xb9, 0x91, 0xc8], tolerance: 20, minPixels: 150, region: { x: 676, y: 408, width: 48, height: 60 } },
  { name: "Argus robe", rgb: [0xbd, 0x80, 0x6e], tolerance: 20, minPixels: 150, region: { x: 716, y: 158, width: 48, height: 60 } },
];

const EXPECTED_TIMELINE_MESSAGES = [
  "Draft a focused project plan",
  "Luma is arranging the reading lamps",
  "Luma sends Orion, Neria, Quill, and Argus into the stacks",
  "Orion studies the star maps for useful references",
  "Orion returns with a concise research brief",
  "Neria checks the archive for stable preferences",
  "Neria finds relevant memory notes",
  "Quill turns findings into a draft",
  "Quill returns a concise draft",
  "Argus checks the answer for risk and gaps",
  "Luma raises the blue approval lantern",
  "Orion returns to the star-map balcony",
  "Neria closes the archive ledger",
  "Quill shelves the illuminated draft",
  "Argus lowers the review lantern",
  "Luma places the final summary on the central desk",
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

function countColorInSceneRegion(buffer: Buffer, rgb: [number, number, number], tolerance: number, region: NonNullable<ColorTarget["region"]>) {
  const image = PNG.sync.read(buffer);
  const xScale = image.width / PIXI_SCENE_SIZE.width;
  const yScale = image.height / PIXI_SCENE_SIZE.height;
  const startX = Math.max(0, Math.floor(region.x * xScale));
  const startY = Math.max(0, Math.floor(region.y * yScale));
  const endX = Math.min(image.width, Math.ceil((region.x + region.width) * xScale));
  const endY = Math.min(image.height, Math.ceil((region.y + region.height) * yScale));
  let count = 0;

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const offset = (image.width * y + x) * 4;
      const red = image.data[offset];
      const green = image.data[offset + 1];
      const blue = image.data[offset + 2];
      const alpha = image.data[offset + 3];

      if (
        alpha > 0 &&
        Math.abs(red - rgb[0]) <= tolerance &&
        Math.abs(green - rgb[1]) <= tolerance &&
        Math.abs(blue - rgb[2]) <= tolerance
      ) {
        count += 1;
      }
    }
  }

  return count;
}

function countVisualPixelsInSceneRegion(buffer: Buffer, probes: VisualColorProbe[], region: NonNullable<ColorTarget["region"]>) {
  const image = PNG.sync.read(buffer);
  const xScale = image.width / PIXI_SCENE_SIZE.width;
  const yScale = image.height / PIXI_SCENE_SIZE.height;
  const startX = Math.max(0, Math.floor(region.x * xScale));
  const startY = Math.max(0, Math.floor(region.y * yScale));
  const endX = Math.min(image.width, Math.ceil((region.x + region.width) * xScale));
  const endY = Math.min(image.height, Math.ceil((region.y + region.height) * yScale));
  let count = 0;

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const offset = (image.width * y + x) * 4;
      const alpha = image.data[offset + 3];

      if (alpha === 0) {
        continue;
      }

      const red = image.data[offset];
      const green = image.data[offset + 1];
      const blue = image.data[offset + 2];
      const matchesProbe = probes.some(
        (probe) =>
          Math.abs(red - probe.rgb[0]) <= probe.tolerance &&
          Math.abs(green - probe.rgb[1]) <= probe.tolerance &&
          Math.abs(blue - probe.rgb[2]) <= probe.tolerance,
      );

      if (matchesProbe) {
        count += 1;
      }
    }
  }

  return count;
}

async function readDebugAgent(page: Page, agentId: string) {
  return page.evaluate(
    (id) => (window as Window & { __LANTERNWOOD_DEBUG_AGENTS__?: Record<string, DebugAgentState> }).__LANTERNWOOD_DEBUG_AGENTS__?.[id],
    agentId,
  );
}

async function assertActiveAgentVisible(canvas: Locator, agent: DebugAgentState) {
  const activeScene = await canvas.screenshot();
  const robePixels = countColorInSceneRegion(activeScene, [0x6c, 0xa7, 0xbd], 20, {
    x: agent.x - 26,
    y: agent.y - 52,
    width: 52,
    height: 70,
  });

  expect(robePixels, "active Orion robe pixels near live position").toBeGreaterThan(80);
}

test("renders a nonblank Pixi scene and completes a mock agent run", async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { __LANTERNWOOD_EVENT_DELAY_MS__?: number }).__LANTERNWOOD_EVENT_DELAY_MS__ = 2_500;
  });
  await page.goto("/");

  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  const frame = page.locator(".scene-frame");
  const frameBox = await frame.boundingBox();
  const canvasBox = await canvas.boundingBox();

  expect(frameBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect(frameBox!.width).toBeGreaterThan(700);
  expect(canvasBox!.width).toBeLessThanOrEqual(frameBox!.width + 1);
  expect(canvasBox!.height).toBeLessThanOrEqual(frameBox!.height + 1);

  for (const target of PIXI_COLOR_TARGETS.filter((item) => !item.region)) {
    await expect
      .poll(async () => inspectScenePixels(await canvas.screenshot())[target.name], {
        message: `${target.name} pixel count`,
        timeout: 10_000,
      })
      .toBeGreaterThan(target.minPixels);
  }

  await page.getByLabel("Task request").fill("Draft a focused project plan");
  await page.getByRole("button", { name: "Send to Luma" }).click();

  const timeline = page.getByRole("region", { name: "Event timeline" });
  await expect(timeline.getByText("Orion studies the star maps for useful references")).toBeVisible({ timeout: 15_000 });
  const timelineCountBefore = await page.locator(".timeline li").count();
  await expect(page.locator(".agent-card", { hasText: "Orion" }).locator("strong")).toHaveText("working");
  const activeOrionBefore = await readDebugAgent(page, "orion");
  expect(activeOrionBefore?.status).toBe("working");
  await assertActiveAgentVisible(canvas, activeOrionBefore!);
  expect(timelineCountBefore).toBeGreaterThan(0);

  await expect(timeline.getByText("Luma raises the blue approval lantern")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".agent-card", { hasText: "Luma" }).locator("strong")).toHaveText("reporting");
  const approvalLuma = await readDebugAgent(page, "luma");
  expect(approvalLuma?.status).toBe("reporting");
  await expect(timeline.getByText("Luma places the final summary on the central desk")).toBeVisible({ timeout: 45_000 });
  await expect(timeline.getByText("Orion returns to the star-map balcony")).toBeVisible();
  await expect(timeline.getByText("Neria closes the archive ledger")).toBeVisible();
  await expect(timeline.getByText("Quill shelves the illuminated draft")).toBeVisible();
  await expect(timeline.getByText("Argus lowers the review lantern")).toBeVisible();

  const timelineMessages = page.locator(".timeline li span:last-child");
  await expect(timelineMessages).toHaveText(EXPECTED_TIMELINE_MESSAGES);

  await expect(page.locator(".agent-card", { hasText: "Luma" }).locator("strong")).toHaveText("done");
  await expect(page.locator(".agent-card", { hasText: "Orion" }).locator("strong")).toHaveText("done");
  await expect(page.locator(".agent-card", { hasText: "Neria" }).locator("strong")).toHaveText("done");
  await expect(page.locator(".agent-card", { hasText: "Argus" }).locator("strong")).toHaveText("done");
  await expect(page.locator(".agent-card", { hasText: "Quill" }).locator("strong")).toHaveText("done");
  await expect(page.getByRole("region", { name: "Live run inspector" })).toContainText("Mode");
  await expect(page.getByRole("region", { name: "Live run inspector" })).toContainText("mock");
  await expect(page.getByRole("region", { name: "Live run inspector" })).toContainText("Research brief: focus the plan around the highest-risk milestone first.");
  await expect(page.getByRole("region", { name: "Live run inspector" })).toContainText("Memory note: keep recommendations concrete, repo-grounded, and action-oriented.");
  await expect(page.getByRole("region", { name: "Live run inspector" })).toContainText("Draft note: turn the findings into a short milestone plan.");
  await expect(page.getByRole("region", { name: "Live run inspector" })).toContainText("Review note: verify scope, risk, and completion criteria before handoff.");

  await page.waitForTimeout(1_000);
  await page.evaluate(() => {
    (window as Window & { __LANTERNWOOD_FREEZE_ANIMATION__?: boolean }).__LANTERNWOOD_FREEZE_ANIMATION__ = true;
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const finalScene = await canvas.screenshot();

  for (const target of PIXI_COLOR_TARGETS.filter((item) => item.region)) {
    const agentId = target.name.split(" ")[0].toLowerCase();
    const agent = await readDebugAgent(page, agentId);

    expect(agent?.status, `final ${target.name} debug status`).toBe("done");
    expect(agent!.x, `final ${target.name} x position`).toBeGreaterThan(0);
    expect(agent!.x, `final ${target.name} x position`).toBeLessThan(PIXI_SCENE_SIZE.width);
    expect(agent!.y, `final ${target.name} y position`).toBeGreaterThan(0);
    expect(agent!.y, `final ${target.name} y position`).toBeLessThan(PIXI_SCENE_SIZE.height);

    if (agentId === "luma") {
      continue;
    }

    const avatarPixels = countVisualPixelsInSceneRegion(finalScene, [
      { rgb: target.rgb, tolerance: target.tolerance + 60 },
      { rgb: [0xf0, 0xca, 0xa0], tolerance: 30 },
      { rgb: [0xf7, 0xea, 0xd0], tolerance: 30 },
    ], {
      x: agent!.x - 42,
      y: agent!.y - 54,
      width: 84,
      height: 112,
    });
    expect(avatarPixels, `final ${target.name} rendered avatar pixels near debug position`).toBeGreaterThan(40);
  }

  await expect(page).toHaveScreenshot("lanternwood-dashboard.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.005,
  });
});

test("shows the permission approval panel and retries from the browser flow", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as Window & {
      __LANTERNWOOD_APPROVAL_TEST_FLOW__?: boolean;
      __LANTERNWOOD_EVENT_DELAY_MS__?: number;
    };

    testWindow.__LANTERNWOOD_APPROVAL_TEST_FLOW__ = true;
    testWindow.__LANTERNWOOD_EVENT_DELAY_MS__ = 10;
  });
  await page.goto("/");

  await page.getByLabel("Task request").fill("Draft a focused project plan");
  await page.getByRole("button", { name: "Send to Luma" }).click();

  const permissionPanel = page.getByRole("region", { name: "Permission request" });
  await expect(permissionPanel).toBeVisible();
  await expect(permissionPanel).toContainText("Orion requests danger-full-access");
  await expect(permissionPanel).toContainText("Needs a file outside the workspace.");
  await expect(permissionPanel).toContainText("write /Users/eunhwa/shared/report.md");
  await expect(page.locator(".agent-card", { hasText: "Orion" }).locator("strong")).toHaveText("waitingApproval");

  const panelBox = await permissionPanel.boundingBox();
  const sceneBox = await page.locator(".scene-frame").boundingBox();

  expect(panelBox).not.toBeNull();
  expect(sceneBox).not.toBeNull();
  expect(panelBox!.y).toBeGreaterThan(sceneBox!.y + sceneBox!.height);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(1280);

  await page.getByRole("button", { name: "Approve and retry" }).click();

  await expect(permissionPanel).toBeHidden();
  await expect(page.getByRole("region", { name: "Final output" })).toContainText("Approved retry completed with danger-full-access.");
  await expect(page.locator(".agent-card", { hasText: "Luma" }).locator("strong")).toHaveText("done");
});

test("fits the Pixi scene inside the visible frame on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const frameBox = await page.locator(".scene-frame").boundingBox();
  const canvasBox = await page.locator("canvas").boundingBox();

  expect(frameBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect(frameBox!.x).toBeGreaterThanOrEqual(0);
  expect(frameBox!.x + frameBox!.width).toBeLessThanOrEqual(390 + 1);
  expect(canvasBox!.width).toBeLessThanOrEqual(frameBox!.width + 1);
  expect(canvasBox!.height).toBeLessThanOrEqual(frameBox!.height + 1);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
});

test("keeps the live inspector beside the scene without clipping on wide screens", async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 900 });
  await page.goto("/");

  const stageBox = await page.locator(".library-stage").boundingBox();
  const sceneBox = await page.locator(".scene-frame").boundingBox();
  const outputBox = await page.locator(".final-output-panel").boundingBox();
  const inspectorBox = await page.locator(".live-run-inspector").boundingBox();
  const sideBox = await page.locator(".side-panel").boundingBox();
  const outputStyle = await page.locator(".final-output-text").evaluate((element) => {
    const style = window.getComputedStyle(element);

    return {
      overflowWrap: style.overflowWrap,
      whiteSpace: style.whiteSpace,
    };
  });

  expect(stageBox).not.toBeNull();
  expect(sceneBox).not.toBeNull();
  expect(outputBox).not.toBeNull();
  expect(inspectorBox).not.toBeNull();
  expect(sideBox).not.toBeNull();
  expect(outputStyle.whiteSpace).toBe("pre-wrap");
  expect(outputStyle.overflowWrap).toBe("anywhere");
  expect(inspectorBox!.x).toBeGreaterThan(sceneBox!.x + sceneBox!.width);
  expect(inspectorBox!.x + inspectorBox!.width).toBeLessThanOrEqual(sideBox!.x);
  expect(outputBox!.y).toBeGreaterThan(sceneBox!.y + sceneBox!.height);
  expect(stageBox!.x + stageBox!.width).toBeLessThanOrEqual(sideBox!.x);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(1700);
});

test("keeps the normal desktop scene large before output is ready", async ({ page }) => {
  await page.setViewportSize({ width: 1699, height: 900 });
  await page.goto("/");

  const sceneBox = await page.locator(".scene-frame").boundingBox();
  const outputBox = await page.locator(".final-output-panel").boundingBox();

  expect(sceneBox).not.toBeNull();
  expect(outputBox).not.toBeNull();
  expect(sceneBox!.width).toBeGreaterThan(700);
  expect(outputBox!.y).toBeGreaterThan(sceneBox!.y + sceneBox!.height);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(1699);
});
