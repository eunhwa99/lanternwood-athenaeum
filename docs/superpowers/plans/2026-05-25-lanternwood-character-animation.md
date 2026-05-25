# Lanternwood Character Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace circular agent tokens with animated game-like character avatars in a richer Lanternwood Athenaeum PixiJS scene.

**Architecture:** Keep the current event-driven app contract: `RunAdapter -> AgentEvent -> reducer -> React panels + PixiJS scene`. Add focused Pixi world modules for avatar parts, animation targets/poses, and background drawing. `LanternwoodScene` keeps Pixi display objects and animation clocks only; reducer state remains the business source of truth.

**Tech Stack:** Vite, React, TypeScript, PixiJS, Vitest, Playwright, pngjs.

---

## File Structure

Create and maintain these boundaries:

```text
src/world/
  avatarAnimation.ts       # status-to-pose and target-position helpers
  avatarAnimation.test.ts
  avatarParts.ts           # Pixi primitive character and prop drawing helpers
  sceneBackground.ts       # Lanternwood library background drawing helpers
  AgentSprite.ts           # character container creation and per-frame updates
  LanternwoodScene.tsx     # Pixi stage lifecycle and ticker update loop
  sceneLayout.ts           # scene constants and canonical home/work positions
  sceneLayout.test.ts
src/harness/
  mockRunAdapter.ts        # expose delayed mock adapter factory for UI animation
  mockRunAdapter.test.ts
src/ui/
  AppShell.tsx             # use delayed mock adapter for visible animation
tests/e2e/
  lanternwood.spec.ts      # updated color buckets and visual regression snapshot
  __snapshots__/lanternwood-dashboard.png
```

## Task 1: Animation Model

**Files:**
- Modify: `src/world/sceneLayout.ts`
- Modify: `src/world/sceneLayout.test.ts`
- Create: `src/world/avatarAnimation.ts`
- Create: `src/world/avatarAnimation.test.ts`

- [ ] **Step 1: Write failing animation tests**

Create `src/world/avatarAnimation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AGENTS } from "../agents/registry";
import { getAvatarPose, getAgentSceneTarget } from "./avatarAnimation";
import { getAgentScenePosition, getAgentWorkPosition } from "./sceneLayout";

describe("avatar animation", () => {
  it("keeps idle and done agents at their home position", () => {
    const luma = AGENTS[0];

    expect(getAgentSceneTarget(luma, "idle")).toEqual(getAgentScenePosition(luma));
    expect(getAgentSceneTarget(luma, "done")).toEqual(getAgentScenePosition(luma));
  });

  it("moves active agents to role-specific work positions", () => {
    const orion = AGENTS.find((agent) => agent.id === "orion")!;

    expect(getAgentSceneTarget(orion, "working")).toEqual(getAgentWorkPosition("orion"));
    expect(getAgentSceneTarget(orion, "reporting")).toEqual(getAgentWorkPosition("orion"));
  });

  it("returns a walking pose while an avatar is travelling", () => {
    const pose = getAvatarPose("working", 0.25, true);

    expect(pose.mode).toBe("moving");
    expect(Math.abs(pose.legSwing)).toBeGreaterThan(0);
    expect(pose.bob).not.toBe(0);
  });

  it("returns a review glow pose for reviewing state", () => {
    const pose = getAvatarPose("reviewing", 0.5, false);

    expect(pose.mode).toBe("reviewing");
    expect(pose.effectAlpha).toBeGreaterThan(0.2);
  });
});
```

- [ ] **Step 2: Run animation tests to verify they fail**

Run:

```bash
npm test -- src/world/avatarAnimation.test.ts
```

Expected: FAIL because `src/world/avatarAnimation.ts` does not exist.

- [ ] **Step 3: Add canonical work positions**

Modify `src/world/sceneLayout.ts`:

```ts
import type { AgentDefinition, AgentId, ScenePosition } from "../agents/types";

export const SCENE_SIZE = {
  width: 960,
  height: 620,
};

export const CENTRAL_DESK: ScenePosition = {
  x: 480,
  y: 300,
};

export const WORK_POSITIONS: Record<AgentId, ScenePosition> = {
  luma: { x: 480, y: 315 },
  orion: { x: 220, y: 190 },
  neria: { x: 260, y: 430 },
  quill: { x: 690, y: 430 },
  argus: { x: 735, y: 195 },
};

export function getAgentScenePosition(agent: AgentDefinition): ScenePosition {
  return agent.homePosition;
}

export function getAgentWorkPosition(agentId: AgentId): ScenePosition {
  return WORK_POSITIONS[agentId];
}
```

Update `src/world/sceneLayout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AGENTS } from "../agents/registry";
import { getAgentScenePosition, getAgentWorkPosition } from "./sceneLayout";

describe("scene layout", () => {
  it("uses the agent definition home position as the scene position", () => {
    for (const agent of AGENTS) {
      expect(getAgentScenePosition(agent)).toEqual(agent.homePosition);
    }
  });

  it("defines a role-specific work position for every agent", () => {
    for (const agent of AGENTS) {
      const position = getAgentWorkPosition(agent.id);

      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.x).toBeLessThanOrEqual(960);
      expect(position.y).toBeGreaterThanOrEqual(0);
      expect(position.y).toBeLessThanOrEqual(620);
    }
  });
});
```

- [ ] **Step 4: Implement animation helpers**

Create `src/world/avatarAnimation.ts`:

```ts
import type { AgentDefinition } from "../agents/types";
import type { AgentStatus } from "../events/types";
import { getAgentScenePosition, getAgentWorkPosition } from "./sceneLayout";

export type AvatarPoseMode =
  | "idle"
  | "planning"
  | "moving"
  | "working"
  | "reporting"
  | "reviewing"
  | "done"
  | "failed";

export type AvatarPose = {
  mode: AvatarPoseMode;
  bob: number;
  armSwing: number;
  legSwing: number;
  propAngle: number;
  effectAlpha: number;
  blinkScale: number;
};

const activeStatuses = new Set<AgentStatus>([
  "planning",
  "moving",
  "working",
  "reporting",
  "reviewing",
  "waitingApproval",
]);

export function getAgentSceneTarget(agent: AgentDefinition, status: AgentStatus) {
  if (activeStatuses.has(status)) {
    return getAgentWorkPosition(agent.id);
  }

  return getAgentScenePosition(agent);
}

export function getAvatarPose(status: AgentStatus, elapsedSeconds: number, isTravelling: boolean): AvatarPose {
  const wave = Math.sin(elapsedSeconds * Math.PI * 2);
  const fastWave = Math.sin(elapsedSeconds * Math.PI * 5);
  const blinkScale = Math.sin(elapsedSeconds * Math.PI * 0.8) > 0.96 ? 0.18 : 1;

  if (isTravelling || status === "moving") {
    return {
      mode: "moving",
      bob: Math.abs(fastWave) * 5,
      armSwing: fastWave * 0.45,
      legSwing: -fastWave * 0.55,
      propAngle: fastWave * 0.15,
      effectAlpha: 0.25,
      blinkScale,
    };
  }

  switch (status) {
    case "planning":
      return { mode: "planning", bob: wave * 2, armSwing: 0.18, legSwing: 0, propAngle: wave * 0.08, effectAlpha: 0.28, blinkScale };
    case "working":
      return { mode: "working", bob: wave * 2, armSwing: fastWave * 0.22, legSwing: 0, propAngle: fastWave * 0.18, effectAlpha: 0.5 + Math.abs(wave) * 0.25, blinkScale };
    case "reporting":
      return { mode: "reporting", bob: wave * 1.5, armSwing: -0.45, legSwing: 0, propAngle: -0.35, effectAlpha: 0.38, blinkScale };
    case "reviewing":
      return { mode: "reviewing", bob: wave * 1.5, armSwing: fastWave * 0.12, legSwing: 0, propAngle: wave * 0.2, effectAlpha: 0.55 + Math.abs(wave) * 0.3, blinkScale };
    case "done":
      return { mode: "done", bob: Math.max(0, wave) * 2, armSwing: -0.2, legSwing: 0, propAngle: -0.1, effectAlpha: 0.18, blinkScale };
    case "failed":
      return { mode: "failed", bob: 0, armSwing: 0, legSwing: 0, propAngle: 0, effectAlpha: 0.7, blinkScale };
    default:
      return { mode: "idle", bob: wave * 2, armSwing: wave * 0.08, legSwing: 0, propAngle: wave * 0.04, effectAlpha: 0.12, blinkScale };
  }
}

export function approach(current: number, target: number, deltaSeconds: number, speed: number) {
  const distance = target - current;
  const step = Math.min(1, deltaSeconds * speed);

  return current + distance * step;
}
```

- [ ] **Step 5: Run animation tests**

Run:

```bash
npm test -- src/world/avatarAnimation.test.ts src/world/sceneLayout.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit animation model**

Run:

```bash
git add src/world/avatarAnimation.ts src/world/avatarAnimation.test.ts src/world/sceneLayout.ts src/world/sceneLayout.test.ts
git commit -m "feat: add Lanternwood avatar animation model"
```

## Task 2: Character Avatar Rendering

**Files:**
- Create: `src/world/avatarParts.ts`
- Modify: `src/world/AgentSprite.ts`
- Test through: `npm run typecheck`, `npm test`

- [ ] **Step 1: Replace token sprite with character sprite**

Create `src/world/avatarParts.ts`:

```ts
import { Container, Graphics } from "pixi.js";
import type { AgentDefinition } from "../agents/types";

export type AvatarParts = {
  root: Container;
  shadow: Graphics;
  body: Container;
  head: Container;
  leftArm: Container;
  rightArm: Container;
  leftLeg: Container;
  rightLeg: Container;
  prop: Container;
  effect: Graphics;
  leftEye: Graphics;
  rightEye: Graphics;
};

function hex(color: string) {
  return Number.parseInt(color.replace("#", ""), 16);
}

function darker(color: string) {
  const value = hex(color);
  const red = Math.max(0, ((value >> 16) & 0xff) - 42);
  const green = Math.max(0, ((value >> 8) & 0xff) - 42);
  const blue = Math.max(0, (value & 0xff) - 42);

  return (red << 16) | (green << 8) | blue;
}

export function createAvatarParts(agent: AgentDefinition): AvatarParts {
  const root = new Container();
  const body = new Container();
  const head = new Container();
  const leftArm = new Container();
  const rightArm = new Container();
  const leftLeg = new Container();
  const rightLeg = new Container();
  const prop = new Container();
  const color = hex(agent.color);
  const darkColor = darker(agent.color);

  const shadow = new Graphics().ellipse(0, 36, 30, 9).fill({ color: 0x071010, alpha: 0.36 });
  const robe = new Graphics()
    .roundRect(-22, -10, 44, 52, 10)
    .fill({ color })
    .stroke({ color: 0xf7ead0, width: 2, alpha: 0.55 });
  const trim = new Graphics().roundRect(-5, -5, 10, 45, 4).fill({ color: 0xf7ead0, alpha: 0.42 });

  body.addChild(robe, trim);

  const face = new Graphics()
    .circle(0, -32, 18)
    .fill({ color: 0xf0caa0 })
    .stroke({ color: 0x3b2d2d, width: 1, alpha: 0.25 });
  const hood = new Graphics()
    .arc(0, -32, 21, Math.PI, Math.PI * 2)
    .stroke({ color: darkColor, width: 10, alpha: 0.98 });
  const leftEye = new Graphics().circle(-6, -33, 2).fill({ color: 0x1d2020 });
  const rightEye = new Graphics().circle(6, -33, 2).fill({ color: 0x1d2020 });
  const smile = new Graphics().arc(0, -28, 6, 0.15, Math.PI - 0.15).stroke({ color: 0x5b3b34, width: 1, alpha: 0.8 });

  head.addChild(hood, face, leftEye, rightEye, smile);

  for (const [arm, side] of [
    [leftArm, -1],
    [rightArm, 1],
  ] as const) {
    const sleeve = new Graphics()
      .roundRect(side === -1 ? -7 : -1, 0, 8, 30, 4)
      .fill({ color: darkColor })
      .stroke({ color: 0xf7ead0, width: 1, alpha: 0.25 });
    arm.x = side * 21;
    arm.y = -4;
    arm.pivot.set(0, 2);
    arm.addChild(sleeve);
  }

  for (const [leg, side] of [
    [leftLeg, -1],
    [rightLeg, 1],
  ] as const) {
    leg.x = side * 10;
    leg.y = 36;
    leg.pivot.set(0, 0);
    leg.addChild(new Graphics().roundRect(-5, 0, 10, 16, 4).fill({ color: 0x26302d }));
  }

  drawAgentProp(prop, agent);
  prop.x = 28;
  prop.y = -10;
  prop.pivot.set(0, 0);

  const effect = new Graphics().circle(0, 4, 36).stroke({ color: 0xf2c66d, width: 2, alpha: 0.5 });

  root.addChild(shadow, leftLeg, rightLeg, body, leftArm, rightArm, head, prop, effect);

  return { root, shadow, body, head, leftArm, rightArm, leftLeg, rightLeg, prop, effect, leftEye, rightEye };
}

function drawAgentProp(container: Container, agent: AgentDefinition) {
  if (agent.id === "orion") {
    container.addChild(new Graphics().circle(0, 0, 8).stroke({ color: 0xd7f3ff, width: 2 }).moveTo(-14, 8).lineTo(8, -10).stroke({ color: 0xd7f3ff, width: 2 }));
    return;
  }

  if (agent.id === "neria") {
    container.addChild(new Graphics().roundRect(-8, -10, 18, 24, 4).fill({ color: 0xe7d6a3 }).stroke({ color: 0x8f7651, width: 1 }));
    return;
  }

  if (agent.id === "quill") {
    container.addChild(new Graphics().moveTo(-8, 12).lineTo(12, -14).stroke({ color: 0xf7ead0, width: 3 }).ellipse(12, -16, 5, 12).fill({ color: 0xf0d6ff }));
    return;
  }

  if (agent.id === "argus") {
    container.addChild(new Graphics().circle(0, 0, 9).fill({ color: 0xf2c66d, alpha: 0.75 }).stroke({ color: 0xfff1b8, width: 2 }));
    return;
  }

  container.addChild(new Graphics().roundRect(-9, -12, 20, 22, 4).fill({ color: 0x6a5035 }).stroke({ color: 0xf2c66d, width: 2 }));
}
```

Replace `src/world/AgentSprite.ts` with:

```ts
import { Container } from "pixi.js";
import type { AgentRuntimeState } from "../events/types";
import { getAvatarPose } from "./avatarAnimation";
import { createAvatarParts, type AvatarParts } from "./avatarParts";

export type AgentSpriteView = {
  container: Container;
  parts: AvatarParts;
};

export function createAgentSprite(agent: AgentRuntimeState): AgentSpriteView {
  const parts = createAvatarParts(agent.definition);
  parts.root.scale.set(1.05);

  return {
    container: parts.root,
    parts,
  };
}

export function updateAgentSprite(view: AgentSpriteView, agent: AgentRuntimeState, elapsedSeconds: number, isTravelling: boolean) {
  const pose = getAvatarPose(agent.status, elapsedSeconds, isTravelling);
  const alpha = agent.status === "idle" ? 0.88 : 1;

  view.container.alpha = alpha;
  view.parts.body.y = -pose.bob;
  view.parts.head.y = -pose.bob * 0.8;
  view.parts.leftArm.rotation = pose.armSwing;
  view.parts.rightArm.rotation = -pose.armSwing;
  view.parts.leftLeg.rotation = pose.legSwing;
  view.parts.rightLeg.rotation = -pose.legSwing;
  view.parts.prop.rotation = pose.propAngle;
  view.parts.effect.alpha = pose.effectAlpha;
  view.parts.effect.scale.set(0.85 + pose.effectAlpha * 0.35);
  view.parts.leftEye.scale.y = pose.blinkScale;
  view.parts.rightEye.scale.y = pose.blinkScale;

  if (pose.mode === "failed") {
    view.container.tint = 0xdd7777;
  } else {
    view.container.tint = 0xffffff;
  }
}
```

- [ ] **Step 2: Run focused verification**

Run:

```bash
npm run typecheck
npm test
```

Expected: PASS.

- [ ] **Step 3: Commit avatar rendering**

Run:

```bash
git add src/world/avatarParts.ts src/world/AgentSprite.ts
git commit -m "feat: render Lanternwood character avatars"
```

## Task 3: Rich Lanternwood Background

**Files:**
- Create: `src/world/sceneBackground.ts`
- Modify: `src/world/LanternwoodScene.tsx`

- [ ] **Step 1: Create background drawing helper**

Create `src/world/sceneBackground.ts`:

```ts
import { Container, Graphics } from "pixi.js";
import { CENTRAL_DESK, SCENE_SIZE } from "./sceneLayout";

export function createSceneBackground() {
  const root = new Container();

  const wall = new Graphics()
    .roundRect(20, 20, SCENE_SIZE.width - 40, SCENE_SIZE.height - 40, 18)
    .fill({ color: 0x1f362f })
    .stroke({ color: 0xd8c781, width: 2, alpha: 0.45 });
  const upperWall = new Graphics().rect(42, 42, SCENE_SIZE.width - 84, 220).fill({ color: 0x18262f, alpha: 0.62 });
  const floor = new Graphics().ellipse(480, 480, 390, 86).fill({ color: 0x273b36, alpha: 0.92 });
  const rug = new Graphics().ellipse(480, 470, 210, 50).fill({ color: 0x6b3f58, alpha: 0.7 }).stroke({ color: 0xe4b969, width: 2, alpha: 0.45 });

  root.addChild(wall, upperWall, floor, rug);
  drawShelves(root, 72, 120, 170, 330);
  drawShelves(root, 718, 120, 170, 330);
  drawWindow(root);
  drawDesk(root);
  drawFloatingPages(root);

  return root;
}

function drawShelves(root: Container, x: number, y: number, width: number, height: number) {
  const shelf = new Graphics().roundRect(x, y, width, height, 8).fill({ color: 0x3e2f29 }).stroke({ color: 0x9f7d4d, width: 2, alpha: 0.65 });
  root.addChild(shelf);

  for (let row = 0; row < 4; row += 1) {
    const shelfY = y + 32 + row * 72;
    root.addChild(new Graphics().rect(x + 10, shelfY + 42, width - 20, 5).fill({ color: 0x9f7d4d }));

    for (let book = 0; book < 9; book += 1) {
      const bookX = x + 16 + book * 16;
      const bookHeight = 24 + ((book + row) % 3) * 8;
      const color = [0x8fa765, 0xb991c8, 0x6ca7bd, 0xbd806e, 0xe4b969][(book + row) % 5];
      root.addChild(new Graphics().roundRect(bookX, shelfY + 42 - bookHeight, 10, bookHeight, 2).fill({ color }));
    }
  }
}

function drawWindow(root: Container) {
  const frame = new Graphics().roundRect(362, 72, 236, 150, 28).fill({ color: 0x0f171b }).stroke({ color: 0xd8c781, width: 3, alpha: 0.6 });
  const moon = new Graphics().circle(544, 112, 18).fill({ color: 0xf7ead0, alpha: 0.85 });
  root.addChild(frame, moon);

  for (let index = 0; index < 18; index += 1) {
    const x = 384 + ((index * 37) % 190);
    const y = 92 + ((index * 23) % 104);
    root.addChild(new Graphics().circle(x, y, 1.5 + (index % 2),).fill({ color: 0xf2c66d, alpha: 0.75 }));
  }

  root.addChild(new Graphics().moveTo(480, 72).lineTo(480, 222).stroke({ color: 0xd8c781, width: 2, alpha: 0.45 }));
  root.addChild(new Graphics().moveTo(362, 148).lineTo(598, 148).stroke({ color: 0xd8c781, width: 2, alpha: 0.45 }));
}

function drawDesk(root: Container) {
  const glow = new Graphics().circle(CENTRAL_DESK.x, CENTRAL_DESK.y + 4, 118).fill({ color: 0xe4b969, alpha: 0.12 });
  const desk = new Graphics()
    .ellipse(CENTRAL_DESK.x, CENTRAL_DESK.y + 18, 112, 54)
    .fill({ color: 0x6a5035 })
    .stroke({ color: 0xf2c66d, width: 2, alpha: 0.5 });
  const lamp = new Graphics()
    .circle(CENTRAL_DESK.x, CENTRAL_DESK.y - 32, 14)
    .fill({ color: 0xf2c66d, alpha: 0.9 })
    .stroke({ color: 0xfff1b8, width: 2, alpha: 0.7 });

  root.addChild(glow, desk, lamp);
}

function drawFloatingPages(root: Container) {
  for (let index = 0; index < 8; index += 1) {
    const x = 310 + ((index * 73) % 340);
    const y = 250 + ((index * 31) % 140);
    root.addChild(new Graphics().roundRect(x, y, 18, 12, 2).fill({ color: 0xf7ead0, alpha: 0.38 }).stroke({ color: 0xe4b969, width: 1, alpha: 0.35 }));
  }
}
```

- [ ] **Step 2: Use background helper in scene**

Modify `src/world/LanternwoodScene.tsx`:

```tsx
import { Application, extend, useApplication } from "@pixi/react";
import { Container, Graphics, Text } from "pixi.js";
import { useEffect, useRef } from "react";
import type { AgentId } from "../agents/types";
import type { RunState } from "../events/types";
import { createAgentSprite, updateAgentSprite, type AgentSpriteView } from "./AgentSprite";
import { approach, getAgentSceneTarget } from "./avatarAnimation";
import { createSceneBackground } from "./sceneBackground";
import { SCENE_SIZE, getAgentScenePosition } from "./sceneLayout";

extend({ Container, Graphics, Text });

type LanternwoodSceneProps = {
  state: RunState;
};

type PositionMap = Record<AgentId, { x: number; y: number }>;

function clearStage(stage: Container) {
  for (const child of stage.removeChildren()) {
    child.destroy({ children: true });
  }
}

function SceneContent({ state }: LanternwoodSceneProps) {
  const { app } = useApplication();
  const stateRef = useRef(state);
  const spritesRef = useRef<Map<AgentId, AgentSpriteView>>(new Map());
  const positionsRef = useRef<PositionMap | null>(null);
  const elapsedRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const stage = app.stage;
    clearStage(stage);
    spritesRef.current.clear();

    const initialPositions = {} as PositionMap;
    stage.addChild(createSceneBackground());

    for (const agent of Object.values(stateRef.current.agents)) {
      const view = createAgentSprite(agent);
      const home = getAgentScenePosition(agent.definition);
      initialPositions[agent.definition.id] = { ...home };
      view.container.x = home.x;
      view.container.y = home.y;
      stage.addChild(view.container);
      spritesRef.current.set(agent.definition.id, view);
    }

    positionsRef.current = initialPositions;

    const tick = () => {
      const deltaSeconds = app.ticker.deltaMS / 1000;
      elapsedRef.current += deltaSeconds;

      for (const agent of Object.values(stateRef.current.agents)) {
        const view = spritesRef.current.get(agent.definition.id);
        const positions = positionsRef.current;

        if (!view || !positions) {
          continue;
        }

        const current = positions[agent.definition.id];
        const target = getAgentSceneTarget(agent.definition, agent.status);
        const distance = Math.hypot(target.x - current.x, target.y - current.y);
        const isTravelling = distance > 2.5;

        current.x = approach(current.x, target.x, deltaSeconds, 4.8);
        current.y = approach(current.y, target.y, deltaSeconds, 4.8);
        view.container.x = current.x;
        view.container.y = current.y;

        updateAgentSprite(view, agent, elapsedRef.current, isTravelling);
      }
    };

    app.ticker.add(tick);

    return () => {
      app.ticker.remove(tick);
      clearStage(stage);
      spritesRef.current.clear();
      positionsRef.current = null;
    };
  }, [app]);

  return null;
}

export function LanternwoodScene({ state }: LanternwoodSceneProps) {
  const pixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;

  return (
    <Application
      antialias
      autoDensity
      backgroundAlpha={0}
      className="lanternwood-canvas"
      height={SCENE_SIZE.height}
      resolution={pixelRatio}
      width={SCENE_SIZE.width}
    >
      <SceneContent state={state} />
    </Application>
  );
}
```

- [ ] **Step 3: Run focused verification**

Run:

```bash
npm run typecheck
npm test
npm run build
```

Expected: PASS with only the existing Pixi chunk-size build warning.

- [ ] **Step 4: Commit background and ticker scene**

Run:

```bash
git add src/world/sceneBackground.ts src/world/LanternwoodScene.tsx
git commit -m "feat: animate Lanternwood Pixi scene"
```

## Task 4: Visible Event Timing

**Files:**
- Modify: `src/harness/mockRunAdapter.ts`
- Modify: `src/harness/mockRunAdapter.test.ts`
- Modify: `src/ui/AppShell.tsx`

- [ ] **Step 1: Write failing delayed adapter test**

Add to `src/harness/mockRunAdapter.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
```

Replace the current import from `vitest` if needed, then add:

```ts
  it("can delay event delivery for visible UI animation", async () => {
    vi.useFakeTimers();
    const adapter = createMockRunAdapter({ eventDelayMs: 300 });
    const iterator = adapter.startRun("Plan my interview prep")[Symbol.asyncIterator]();

    const first = iterator.next();
    await vi.advanceTimersByTimeAsync(299);

    let settled = false;
    first.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect((await first).value.type).toBe("task.created");
    vi.useRealTimers();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/harness/mockRunAdapter.test.ts
```

Expected: FAIL because `createMockRunAdapter` does not exist.

- [ ] **Step 3: Implement delayed adapter factory**

Modify `src/harness/mockRunAdapter.ts`:

```ts
import type { AgentEvent } from "../events/types";
import type { RunAdapter } from "./runAdapter";

type MockRunAdapterOptions = {
  eventDelayMs?: number;
};

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function stableTaskId(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const encoded = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

  return `task-${encoded || "empty"}`;
}

function event(
  taskId: string,
  index: number,
  agentId: AgentEvent["agentId"],
  type: AgentEvent["type"],
  message: string,
): AgentEvent {
  return {
    eventId: `${taskId}-evt-${index}`,
    taskId,
    agentId,
    type,
    message,
    timestamp: new Date(Date.UTC(2026, 4, 25, 0, 0, index)).toISOString(),
  };
}

export function createMockRunAdapter(options: MockRunAdapterOptions = {}): RunAdapter {
  const eventDelayMs = options.eventDelayMs ?? 0;

  return {
    async *startRun(input: string) {
      const taskId = stableTaskId(input);
      const events: AgentEvent[] = [
        event(taskId, 1, "luma", "task.created", input),
        event(taskId, 2, "luma", "agent.planning", "Luma is arranging the reading lamps"),
        event(taskId, 3, "luma", "agent.delegated", "Luma sends Orion and Neria into the stacks"),
        event(taskId, 4, "orion", "agent.working", "Orion studies the star maps for useful references"),
        event(taskId, 5, "orion", "agent.reporting", "Orion returns with a concise research brief"),
        event(taskId, 6, "neria", "agent.working", "Neria checks the archive for stable preferences"),
        event(taskId, 7, "neria", "agent.reporting", "Neria finds relevant memory notes"),
        event(taskId, 8, "argus", "agent.reviewing", "Argus checks the answer for risk and gaps"),
        event(taskId, 9, "orion", "agent.done", "Orion returns to the star-map balcony"),
        event(taskId, 10, "neria", "agent.done", "Neria closes the archive ledger"),
        event(taskId, 11, "argus", "agent.done", "Argus lowers the review lantern"),
        event(taskId, 12, "luma", "agent.done", "Luma places the final summary on the central desk"),
      ];

      for (const item of events) {
        if (eventDelayMs > 0) {
          await wait(eventDelayMs);
        }

        yield item;
      }
    },
  };
}

export const mockRunAdapter = createMockRunAdapter();
```

- [ ] **Step 4: Use delayed adapter in UI**

Modify `src/ui/AppShell.tsx`:

```tsx
import { createMockRunAdapter } from "../harness/mockRunAdapter";
```

Add module constant:

```tsx
const visibleMockRunAdapter = createMockRunAdapter({ eventDelayMs: 420 });
```

Use it:

```tsx
for await (const event of visibleMockRunAdapter.startRun(prompt)) {
  setRunState((current) => reduceAgentEvent(current, event));
}
```

- [ ] **Step 5: Run focused verification**

Run:

```bash
npm test -- src/harness/mockRunAdapter.test.ts src/ui/AppShell.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit visible event timing**

Run:

```bash
git add src/harness/mockRunAdapter.ts src/harness/mockRunAdapter.test.ts src/ui/AppShell.tsx
git commit -m "feat: pace mock events for avatar animation"
```

## Task 5: E2E Visual QA Update

**Files:**
- Modify: `tests/e2e/lanternwood.spec.ts`
- Modify: `tests/e2e/__snapshots__/lanternwood-dashboard.png`

- [ ] **Step 1: Update color buckets**

Update `tests/e2e/lanternwood.spec.ts` color targets to match the richer scene and character colors:

```ts
const PIXI_COLOR_TARGETS: ColorTarget[] = [
  { name: "library wall", rgb: [0x1f, 0x36, 0x2f], tolerance: 3, minPixels: 180_000 },
  { name: "upper wall", rgb: [0x18, 0x26, 0x2f], tolerance: 6, minPixels: 60_000 },
  { name: "central desk", rgb: [0x6a, 0x50, 0x35], tolerance: 6, minPixels: 8_000 },
  { name: "Luma robe", rgb: [0xf2, 0xc6, 0x6d], tolerance: 12, minPixels: 70 },
  { name: "Orion robe", rgb: [0x6c, 0xa7, 0xbd], tolerance: 12, minPixels: 70 },
  { name: "Neria robe", rgb: [0x8f, 0xa7, 0x65], tolerance: 12, minPixels: 70 },
  { name: "Quill robe", rgb: [0xb9, 0x91, 0xc8], tolerance: 12, minPixels: 70 },
  { name: "Argus robe", rgb: [0xbd, 0x80, 0x6e], tolerance: 12, minPixels: 70 },
];
```

- [ ] **Step 2: Run e2e update**

Run:

```bash
npm run e2e:update
```

Expected: PASS and update `tests/e2e/__snapshots__/lanternwood-dashboard.png`.

- [ ] **Step 3: Run e2e normally**

Run:

```bash
npm run e2e
```

Expected: PASS.

- [ ] **Step 4: Commit e2e update**

Run:

```bash
git add tests/e2e/lanternwood.spec.ts tests/e2e/__snapshots__/lanternwood-dashboard.png
git commit -m "test: update Lanternwood visual QA for avatars"
```

## Task 6: Full Verification And Review

**Files:**
- Modify only if verification or review finds defects.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run e2e
```

Expected:

- typecheck exits 0
- Vitest exits 0
- lint exits 0
- build exits 0 with only the existing Pixi chunk-size warning
- Playwright e2e exits 0

- [ ] **Step 2: Run fresh five-reviewer pass**

Use `$subagent-review-loop` with five fresh reviewers:

- animation model and state mapping
- Pixi display lifecycle and ticker cleanup
- character/background visual quality
- Playwright visual QA robustness
- TypeScript/package hygiene

Expected: the newest fresh five-reviewer pass reports no actionable findings.

- [ ] **Step 3: Fix actionable findings**

If any reviewer reports actionable findings:

1. Fix the issue in the responsible file.
2. Rerun the narrow verification.
3. Rerun full verification.
4. Spawn a fresh five-reviewer pass.

- [ ] **Step 4: Final status check**

Run:

```bash
git status --short --branch
```

Expected: clean worktree.

## Self-Review Notes

- Spec coverage: character avatars, state animation, movement, rich background, event-driven boundary, and visual QA are mapped to tasks.
- Placeholder scan: this plan contains no incomplete-work markers.
- Type consistency: `AgentStatus`, `AgentDefinition`, `AgentId`, `AgentSpriteView`, `AvatarPose`, and scene layout helper names are defined before use.
