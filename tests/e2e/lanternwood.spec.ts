import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { PNG } from "pngjs";
import { createAgentDefinition } from "../../server/agentCatalog";

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

type UiQualityScore = {
  hardGateFailures: string[];
  score: number;
  scrollRatio: number;
};

type UiQualityOptions = {
  controlSelectors?: string[];
  enforceViewportClipping?: boolean;
  maxInternalScrollRatio: number;
  maxScrollRatio: number;
  viewportLabel: string;
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
test.describe.configure({ mode: "serial" });

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

async function scoreUiQuality(page: Page, options: UiQualityOptions): Promise<UiQualityScore> {
  return page.evaluate(({ controlSelectors, enforceViewportClipping, maxInternalScrollRatio, maxScrollRatio, viewportLabel }) => {
    type ElementBox = {
      element: Element;
      height: number;
      label: string;
      width: number;
      x: number;
      y: number;
    };

    function visibleBox(element: Element, label: string): ElementBox | undefined {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      let parent: Element | null = element;

      while (parent) {
        if (
          parent.hasAttribute("hidden") ||
          parent.hasAttribute("inert") ||
          parent.getAttribute("aria-hidden") === "true" ||
          parent.matches("details:not([open]) *")
        ) {
          return undefined;
        }

        parent = parent.parentElement;
      }

      if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
        return undefined;
      }

      return {
        element,
        height: rect.height,
        label,
        width: rect.width,
        x: rect.x,
        y: rect.y,
      };
    }

    function boxesForSelectors(selectors: string[]) {
      return selectors.flatMap((selector) =>
        Array.from(document.querySelectorAll(selector), (element, index) => visibleBox(element, `${selector}:${index}`)).filter(
          (box): box is ElementBox => Boolean(box),
        ),
      );
    }

    function boxCenter(box: ElementBox) {
      return {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      };
    }

    function visibleRatio(box: ElementBox, includeScrollableClips: boolean) {
      let left = Math.max(0, box.x);
      let top = Math.max(0, box.y);
      let right = Math.min(window.innerWidth, box.x + box.width);
      let bottom = Math.min(window.innerHeight, box.y + box.height);
      let parent = box.element.parentElement;

      while (parent) {
        const style = window.getComputedStyle(parent);
        const clipsContent = [style.overflow, style.overflowX, style.overflowY].some((value) =>
          includeScrollableClips ? /auto|clip|hidden|scroll/.test(value) : /clip|hidden/.test(value),
        );

        if (clipsContent) {
          const rect = parent.getBoundingClientRect();
          left = Math.max(left, rect.left);
          top = Math.max(top, rect.top);
          right = Math.min(right, rect.right);
          bottom = Math.min(bottom, rect.bottom);
        }

        parent = parent.parentElement;
      }

      const visibleWidth = Math.max(0, right - left);
      const visibleHeight = Math.max(0, bottom - top);
      const area = box.width * box.height;

      return area > 0 ? (visibleWidth * visibleHeight) / area : 0;
    }

    function ancestorClipRatio(box: ElementBox, includeScrollableClips: boolean) {
      let left = box.x;
      let top = box.y;
      let right = box.x + box.width;
      let bottom = box.y + box.height;
      let parent = box.element.parentElement;

      while (parent) {
        const style = window.getComputedStyle(parent);
        const clipsContent = [style.overflow, style.overflowX, style.overflowY].some((value) =>
          includeScrollableClips ? /auto|clip|hidden|scroll/.test(value) : /clip|hidden/.test(value),
        );

        if (clipsContent) {
          const rect = parent.getBoundingClientRect();
          left = Math.max(left, rect.left);
          top = Math.max(top, rect.top);
          right = Math.min(right, rect.right);
          bottom = Math.min(bottom, rect.bottom);
        }

        parent = parent.parentElement;
      }

      const visibleWidth = Math.max(0, right - left);
      const visibleHeight = Math.max(0, bottom - top);
      const area = box.width * box.height;

      return area > 0 ? (visibleWidth * visibleHeight) / area : 0;
    }

    function viewportVisibleRatio(box: ElementBox) {
      const visibleWidth = Math.max(0, Math.min(window.innerWidth, box.x + box.width) - Math.max(0, box.x));
      const visibleHeight = Math.max(0, Math.min(window.innerHeight, box.y + box.height) - Math.max(0, box.y));
      const area = box.width * box.height;

      return area > 0 ? (visibleWidth * visibleHeight) / area : 0;
    }

    function isOutsideScrollableAncestor(box: ElementBox) {
      const center = boxCenter(box);
      let parent = box.element.parentElement;

      while (parent) {
        const style = window.getComputedStyle(parent);
        const isScrollable = [style.overflow, style.overflowX, style.overflowY].some((value) => /auto|scroll/.test(value));

        if (isScrollable) {
          const rect = parent.getBoundingClientRect();

          if (center.x < rect.left || center.x > rect.right || center.y < rect.top || center.y > rect.bottom) {
            return true;
          }
        }

        parent = parent.parentElement;
      }

      return false;
    }

    function isHitTestable(box: ElementBox) {
      const center = boxCenter(box);
      const hitElement = document.elementFromPoint(center.x, center.y);

      return Boolean(hitElement && (hitElement === box.element || box.element.contains(hitElement)));
    }

    function overlapRatio(a: ElementBox, b: ElementBox) {
      const overlapWidth = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
      const overlapHeight = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      const overlapArea = overlapWidth * overlapHeight;
      const smallestArea = Math.min(a.width * a.height, b.width * b.height);

      return smallestArea > 0 ? overlapArea / smallestArea : 0;
    }

    const primaryBoxes = boxesForSelectors([
      ".dashboard-top",
      ".scene-frame",
      ".task-input",
      ".work-queue",
      ".live-run-inspector",
    ]);
    const controlBoxes = boxesForSelectors(controlSelectors ?? ["button", "input", ".agents-summary span"]);
    const contentClipBoxes = boxesForSelectors([
      "button",
      ".agents-summary span",
      ".work-queue-item",
      ".task-summary-prompt",
    ]);
    const scrollContainers = boxesForSelectors([
      ".task-summary-prompt",
      ".agents-summary",
      ".work-queue-list",
      ".agent-output-grid",
      ".agent-output-card p",
    ]);
    const hardGateFailures: string[] = [];
    const scrollRatio = document.documentElement.scrollHeight / window.innerHeight;

    if (document.documentElement.scrollWidth > window.innerWidth) {
      hardGateFailures.push(`${viewportLabel}:horizontal-overflow`);
    }

    const hitTestableControlBoxes: ElementBox[] = [];
    for (const box of controlBoxes) {
      const viewportRatio = viewportVisibleRatio(box);
      const nonScrollableClipRatio = visibleRatio(box, false);
      const allClipRatio = visibleRatio(box, true);

      if (viewportRatio === 0 || isOutsideScrollableAncestor(box)) {
        continue;
      }

      if (nonScrollableClipRatio === 0) {
        hardGateFailures.push(`${viewportLabel}:${box.label}-fully-clipped`);
      } else if (nonScrollableClipRatio < 0.95) {
        hardGateFailures.push(`${viewportLabel}:${box.label}-partially-clipped`);
      } else if (allClipRatio < 0.95) {
        continue;
      } else if (isHitTestable(box)) {
        hitTestableControlBoxes.push(box);
      } else {
        hardGateFailures.push(`${viewportLabel}:${box.label}-not-hit-testable`);
      }
    }

    for (let outer = 0; outer < primaryBoxes.length; outer += 1) {
      for (let inner = outer + 1; inner < primaryBoxes.length; inner += 1) {
        const a = primaryBoxes[outer];
        const b = primaryBoxes[inner];

        if (overlapRatio(a, b) > 0.02) {
          hardGateFailures.push(`${viewportLabel}:${a.label}-overlaps-${b.label}`);
        }
      }
    }

    for (let outer = 0; outer < hitTestableControlBoxes.length; outer += 1) {
      for (let inner = outer + 1; inner < hitTestableControlBoxes.length; inner += 1) {
        const a = hitTestableControlBoxes[outer];
        const b = hitTestableControlBoxes[inner];

        if (a.element.contains(b.element) || b.element.contains(a.element)) {
          continue;
        }

        if (overlapRatio(a, b) > 0.15) {
          hardGateFailures.push(`${viewportLabel}:${a.label}-overlaps-${b.label}`);
        }
      }
    }

    let score = 100;
    for (const box of contentClipBoxes) {
      if (viewportVisibleRatio(box) === 0 || isOutsideScrollableAncestor(box)) {
        continue;
      }

      if (enforceViewportClipping && viewportVisibleRatio(box) < 0.95) {
        hardGateFailures.push(`${viewportLabel}:${box.label}-viewport-clipped`);
        continue;
      }

      if (ancestorClipRatio(box, false) < 0.95) {
        hardGateFailures.push(`${viewportLabel}:${box.label}-partially-clipped`);
        continue;
      }

      if (box.element.scrollWidth > box.element.clientWidth + 1 || box.element.scrollHeight > box.element.clientHeight + 1) {
        hardGateFailures.push(`${viewportLabel}:${box.label}-clips-content`);
      }
    }

    for (const box of scrollContainers) {
      const internalScrollRatio = box.element.scrollHeight / Math.max(1, box.element.clientHeight);

      if (internalScrollRatio > maxInternalScrollRatio + 0.5) {
        score -= 20;
      } else if (internalScrollRatio > maxInternalScrollRatio) {
        score -= 10;
      }
    }

    if (scrollRatio > maxScrollRatio + 0.25) {
      score -= 20;
    } else if (scrollRatio > maxScrollRatio) {
      score -= 10;
    }
    score -= hardGateFailures.length * 30;

    return {
      hardGateFailures,
      score: Math.max(0, score),
      scrollRatio,
    };
  }, options);
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
  await page.getByRole("button", { name: "Send to Queue" }).click();

  const activeUiQuality = await scoreUiQuality(page, {
    controlSelectors: ["button", "input"],
    maxInternalScrollRatio: 3,
    maxScrollRatio: 2.2,
    viewportLabel: "desktop-active-run",
  });
  expect(activeUiQuality.hardGateFailures).toEqual([]);
  expect(activeUiQuality.score).toBeGreaterThanOrEqual(90);

  await expect.poll(async () => (await readDebugBubbleHistory(page)).map((bubble) => bubble.text).join("\n")).toContain(
    "[T1] Orion task: Review this code and verify risky edge cases",
  );
  await expect.poll(async () => (await readDebugAgent(page, "luma"))?.x ?? 999).toBeLessThan(initialLuma!.x);
  await expect
    .poll(async () => (await readDebugBubbleHistory(page)).some((bubble) => bubble.text.includes("[T1] Orion answered")))
    .toBe(true);
  const promptBubble = (await readDebugBubbleHistory(page)).find((bubble) => bubble.text.includes("Orion"));
  expect(promptBubble?.owner).toBe("luma");
  expect(promptBubble?.text).not.toContain("highest-risk milestone");
  expect(promptBubble?.lifetime).toBeGreaterThanOrEqual(2.1);
  expect(promptBubble?.lifetime).toBeLessThanOrEqual(2.3);

  await expect(page.getByRole("button", { name: "Open final output for T1 Review this code and verify risky edge cases" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Open full final output" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Final output" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Routing decision" })).toHaveCount(0);
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

  await page.getByRole("button", { name: "Open final output for T1 Review this code and verify risky edge cases" }).click();
  const finalDrawer = page.getByRole("dialog", { name: "Run details" });
  await expect(page.getByRole("tab", { name: "Final output" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Agent reports" })).toHaveAttribute("aria-selected", "true");
  await expect(finalDrawer).toContainText("Luma Details");
  await expect(finalDrawer).toContainText("Here is the focused plan synthesized from Orion and Argus.");
  await expect(finalDrawer).toContainText("T1");
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Open run log" }).click();
  await page.getByRole("tab", { name: "Routing" }).click();
  await expect(page.getByRole("dialog", { name: "Run details" })).toContainText("Selected agents: Orion, Argus");
  await page.getByRole("tab", { name: "Run log" }).click();
  await expect(page.getByRole("dialog", { name: "Run details" })).toContainText("Luma -> Orion");
  await expect(page.getByRole("dialog", { name: "Run details" })).toContainText("Orion report: Research brief");
  await page.getByRole("button", { name: "Close" }).click();

  const finalUiQuality = await scoreUiQuality(page, {
    maxInternalScrollRatio: 3,
    maxScrollRatio: 2.2,
    viewportLabel: "desktop-completed-run",
  });
  expect(finalUiQuality.hardGateFailures).toEqual([]);
  expect(finalUiQuality.score).toBeGreaterThanOrEqual(90);

  await page.evaluate(() => {
    (window as Window & { __LANTERNWOOD_FREEZE_ANIMATION__?: boolean }).__LANTERNWOOD_FREEZE_ANIMATION__ = false;
  });
  await expect.poll(async () => (await readDebugBubbles(page)).length).toBe(0);

  await expect(page).toHaveScreenshot("lanternwood-dashboard.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.005,
  });

  const previousBubbleHistoryLength = (await readDebugBubbleHistory(page)).length;
  const implementationPrompt = "이 앱에 task를 입력하면 코드 생성 기능을 구현해줘";
  await page.getByLabel("Task request").fill(implementationPrompt);
  await page.getByRole("button", { name: "Send to Queue" }).click();
  await expect.poll(async () => (await readDebugBubbleHistory(page)).length).toBeGreaterThan(previousBubbleHistoryLength);
  await expect.poll(async () => (await readDebugBubbleHistory(page)).map((bubble) => bubble.text).join("\n")).toContain(
    `[T2] Orion task: ${implementationPrompt}`,
  );
  await expect.poll(async () => (await readDebugBubbleHistory(page)).map((bubble) => bubble.text).join("\n")).toContain(
    `[T2] Quill task: ${implementationPrompt}`,
  );
});

test("keeps the layout stable on mobile without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await assertCanvasFitsFrame(page.locator("canvas"), page.locator(".scene-frame"));
  await expectNoHorizontalOverflow(page, 390);
  const uiQuality = await scoreUiQuality(page, {
    maxInternalScrollRatio: 3,
    maxScrollRatio: 2.4,
    viewportLabel: "mobile",
  });
  expect(uiQuality.hardGateFailures).toEqual([]);
  expect(uiQuality.score).toBeGreaterThanOrEqual(90);
  expect(uiQuality.scrollRatio).toBeLessThanOrEqual(2.4);
});

test("shows a permission request and retries with the approved sandbox", async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & {
      __LANTERNWOOD_APPROVAL_TEST_FLOW__?: boolean;
      __LANTERNWOOD_EVENT_DELAY_MS__?: number;
    }).__LANTERNWOOD_APPROVAL_TEST_FLOW__ = true;
    (window as Window & { __LANTERNWOOD_EVENT_DELAY_MS__?: number }).__LANTERNWOOD_EVENT_DELAY_MS__ = 0;
  });
  await page.goto("/");

  await page.getByLabel("Task request").fill("Research outside workspace");
  await page.getByRole("button", { name: "Send to Queue" }).click();

  const permissionPanel = page.getByRole("region", { name: "Permission request" });
  await expect(permissionPanel).toContainText("Orion requests danger-full-access");
  await expect(permissionPanel).toContainText("write /Users/eunhwa/shared/report.md");

  await permissionPanel.getByRole("button", { name: "Approve and retry" }).click();

  await expect(page.getByRole("region", { name: "Work queue" })).toContainText("Approved retry completed with danger-full-access.");
  await expect(permissionPanel).toHaveCount(0);
});

test("creates a repo-local agent, reloads it into routing, and renders workspace metadata", async ({ page }) => {
  const agentId = `e2e-scribe-${Date.now()}`;
  const catalogRoot = join(process.cwd(), ".agents", "lanternwood", "agents");
  const agentDirectory = join(catalogRoot, agentId);
  const displayName = agentId
    .split("-")
    .map((token) => (token.length <= 3 ? token.toUpperCase() : `${token.charAt(0).toUpperCase()}${token.slice(1)}`))
    .join(" ");
  const workspaceName = basename(process.cwd());
  const launchedWorkspacePath = join(process.cwd(), "..", ".lanternwood-worktrees", "lanternwood-athenaeum-abc123", "feature-branch-launcher-def456");
  let launchedRequestBody: { branch?: string; repositoryPath?: string } | null = null;

  await page.route("**/api/agents/draft", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        draft: {
          color: "#4F8FBA",
          displayName,
          id: agentId,
          persona: `Codex drafted persona for ${agentId} orbital-index calibration work.`,
          promptInstruction: "Inspect orbital-index tasks and return concise implementation notes.",
          routingKeywords: [agentId, "orbital-index", "calibration"],
          routingReason: "orbital-index calibration",
          worldRole: "Scriptorium tester",
        },
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/agents", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      color: string;
      displayName: string;
      id: string;
      persona: string;
      promptInstruction: string;
      routingKeywords: string[];
      routingReason: string;
      worldRole: string;
    };
    const created = await createAgentDefinition(catalogRoot, body);

    await route.fulfill({
      body: JSON.stringify(created),
      contentType: "application/json",
      status: 201,
    });
  });
  await page.route("**/api/workspaces", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        currentWorkspace: process.cwd(),
        roots: [process.cwd()],
        workspaces: [{ name: workspaceName, path: process.cwd(), root: process.cwd() }],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/worktrees/launch", async (route) => {
    launchedRequestBody = JSON.parse(route.request().postData() ?? "{}") as { branch?: string; repositoryPath?: string };
    await route.fulfill({
      body: JSON.stringify({
        branch: "feature/branch-launcher",
        created: true,
        repositoryPath: process.cwd(),
        statusMessage: "Created new worktree for feature/branch-launcher",
        workspacePath: launchedWorkspacePath,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/workspace-metadata", async (route) => {
    const requestedWorkspace = JSON.parse(route.request().postData() ?? "{}") as { workspacePath?: string };
    await route.fulfill({
      body: JSON.stringify({
        metadata: {
          agentContextFiles: ["AGENTS.md", `.agents/lanternwood/agents/${agentId}/agent.json`],
          changedFiles: ["src/generated.ts"],
          diffExcerpt: "diff --git a/src/generated.ts b/src/generated.ts",
          gitStatus: " M src/generated.ts",
          packageScripts: [{ command: "vitest run", name: "test" }],
          verification: { command: "npm test", exitCode: 0, output: "Tests passed" },
          workspacePath: requestedWorkspace.workspacePath ?? process.cwd(),
        },
        skills: [
          {
            description: "Use for generated build tasks",
            name: "build-helper",
            path: join(process.env.HOME ?? "/home/eunhwapark", ".codex", "skills", "build-helper", "SKILL.md"),
          },
        ],
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  try {
    await page.goto("/");
    await page.getByRole("button", { name: `Select workspace ${workspaceName}` }).click();
    await page.getByText("Branch launcher").click();
    await page.getByLabel("Branch name").fill("feature/branch-launcher");
    await page.getByRole("button", { name: "Launch worktree" }).click();
    await expect(page.getByRole("region", { name: "Workspace", exact: true })).toContainText(
      "Created new worktree for feature/branch-launcher",
    );
    await expect(page.getByLabel("Target workspace")).toHaveValue(launchedWorkspacePath);
    await page.getByRole("button", { name: "Inspect workspace" }).click();
    expect(launchedRequestBody).toEqual({ branch: "feature/branch-launcher", repositoryPath: process.cwd() });
    await expect(page.getByRole("region", { name: "Workspace context" })).toContainText("AGENTS.md");
    await expect(page.getByRole("region", { name: "Workspace context" })).toContainText(launchedWorkspacePath);
    await expect(page.getByRole("region", { name: "Run results" })).toContainText("src/generated.ts");
    await expect(page.getByRole("region", { name: "Skill discovery" })).toContainText("build-helper");

    await page.getByText("Agent Library").click();
    await page.getByLabel("Agent description").fill(`${agentId} orbital-index calibration specialist`);
    await page.getByRole("button", { name: "Generate with Codex" }).click();
    await expect(page.getByLabel("Agent Library")).toContainText("Codex draft ready. Review before creating.");
    await expect(page.getByRole("region", { name: "Agent draft preview" })).toContainText(displayName);
    await page.getByRole("button", { name: "Create agent" }).click();

    await expect(page.getByLabel("Agent Library")).toContainText(`Agent ${agentId} created. Reload to activate.`);
    await expect.poll(async () => readFile(join(agentDirectory, "agent.json"), "utf8")).toContain(`"id": "${agentId}"`);
    await expect.poll(async () => readFile(join(agentDirectory, "persona.md"), "utf8")).toContain("Codex drafted persona");

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByLabel("Agents summary")).toContainText(`${displayName}: idle`);
    await page.getByLabel("Task request").fill(`Use ${agentId} for orbital-index calibration`);
    await page.getByRole("button", { name: "Send to Queue" }).click();
    await expect(page.getByRole("region", { name: "Work queue" })).toContainText(`Here is the focused plan synthesized from ${displayName}.`, {
      timeout: 30_000,
    });
  } finally {
    await rm(agentDirectory, { force: true, recursive: true });
  }
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
  const uiQuality = await scoreUiQuality(page, {
    maxInternalScrollRatio: 3,
    maxScrollRatio: 1.3,
    viewportLabel: "wide",
  });
  expect(uiQuality.hardGateFailures).toEqual([]);
  expect(uiQuality.score).toBeGreaterThanOrEqual(90);
  expect(uiQuality.scrollRatio).toBeLessThanOrEqual(1.3);
});
