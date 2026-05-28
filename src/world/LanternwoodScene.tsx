import { Application, extend, useApplication } from "@pixi/react";
import { Container, Graphics, Text } from "pixi.js";
import { useEffect, useRef } from "react";
import type { AgentId } from "../agents/types";
import type { AgentEvent, AgentStatus, RunState } from "../events/types";
import { createAgentSprite, updateAgentSprite, type AgentSpriteView } from "./AgentSprite";
import { approach, getAgentSceneTarget } from "./avatarAnimation";
import { createSceneBackground } from "./sceneBackground";
import { SCENE_SIZE, getAgentScenePosition, getAgentWorkPosition } from "./sceneLayout";

extend({ Container, Graphics, Text });

type LanternwoodSceneProps = {
  runEpoch?: number;
  state: RunState;
};

type PositionMap = Record<AgentId, { x: number; y: number }>;
type StatusClockMap = Record<AgentId, { status: AgentStatus; changedAt: number }>;
type BubbleView = {
  background: Graphics;
  container: Container;
  createdAt: number;
  expiresAt: number;
  owner: AgentId;
  text: Text;
};
type DispatchTarget = {
  expiresAt: number;
  recipientAgentId: AgentId;
  speechBubble: string;
};

declare global {
  interface Window {
    __LANTERNWOOD_DEBUG_AGENTS__?: Record<string, { status: AgentStatus; x: number; y: number; zIndex: number }>;
    __LANTERNWOOD_DEBUG_BUBBLES__?: Array<{ expiresIn: number; lifetime: number; owner: AgentId; text: string; x: number; y: number }>;
    __LANTERNWOOD_DEBUG_BUBBLE_HISTORY__?: Array<{ lifetime: number; owner: AgentId; text: string }>;
    __LANTERNWOOD_FREEZE_ANIMATION__?: boolean;
  }
}

function clearStage(stage: Container) {
  for (const child of stage.removeChildren()) {
    child.destroy({ children: true });
  }
}

function isAnimationFrozen() {
  return typeof window !== "undefined" && window.__LANTERNWOOD_FREEZE_ANIMATION__ === true;
}

function updateDebugAgent(agentId: AgentId, status: AgentStatus, x: number, y: number, zIndex: number) {
  if (typeof window === "undefined") {
    return;
  }

  window.__LANTERNWOOD_DEBUG_AGENTS__ = {
    ...window.__LANTERNWOOD_DEBUG_AGENTS__,
    [agentId]: { status, x, y, zIndex },
  };
}

function createBubbleView(): BubbleView {
  const container = new Container();
  const background = new Graphics();
  const text = new Text({
    style: {
      fill: 0x13201d,
      fontFamily: "Inter, sans-serif",
      fontSize: 14,
      wordWrap: true,
      wordWrapWidth: 210,
    },
    text: "",
  });

  text.x = 10;
  text.y = 8;
  container.visible = false;
  container.addChild(background, text);

  return {
    background,
    container,
    createdAt: 0,
    expiresAt: 0,
    owner: "luma",
    text,
  };
}

function drawBubble(view: BubbleView, content: string) {
  view.text.text = content;
  const width = Math.min(230, Math.max(70, view.text.width + 20));
  const height = Math.max(34, view.text.height + 16);

  view.background.clear().roundRect(0, 0, width, height, 8).fill({ color: 0xf5eddb, alpha: 0.94 }).stroke({
    color: 0xe4b969,
    width: 2,
  });
}

function bubbleTextFromEvent(event: AgentEvent) {
  const payload = event.payload as Record<string, unknown> | undefined;
  const value = payload?.speechBubble ?? payload?.promptExcerpt ?? payload?.reportExcerpt;

  return typeof value === "string" && value.trim() ? value : undefined;
}

function updateDebugBubbles(bubbles: BubbleView[], elapsedSeconds: number) {
  if (typeof window === "undefined") {
    return;
  }

  window.__LANTERNWOOD_DEBUG_BUBBLES__ = bubbles
    .filter((bubble) => bubble.container.visible)
    .map((bubble) => ({
      owner: bubble.owner,
      text: bubble.text.text,
      expiresIn: Math.max(0, bubble.expiresAt - elapsedSeconds),
      lifetime: bubble.expiresAt - bubble.createdAt,
      x: bubble.container.x,
      y: bubble.container.y,
    }));
}

function appendDebugBubbleHistory(bubble: BubbleView) {
  if (typeof window === "undefined") {
    return;
  }

  window.__LANTERNWOOD_DEBUG_BUBBLE_HISTORY__ = [
    ...(window.__LANTERNWOOD_DEBUG_BUBBLE_HISTORY__ ?? []).slice(-24),
    {
      lifetime: bubble.expiresAt - bubble.createdAt,
      owner: bubble.owner,
      text: bubble.text.text,
    },
  ];
}

function showBubble(
  bubbles: BubbleView[],
  owner: AgentId,
  text: string,
  elapsedSeconds: number,
  lifetimeSeconds: number,
  replaceOwner = false,
) {
  if (replaceOwner) {
    for (const bubble of bubbles) {
      if (bubble.owner === owner) {
        bubble.container.visible = false;
        bubble.createdAt = 0;
        bubble.expiresAt = 0;
      }
    }
  }

  const bubble = bubbles.shift();

  if (!bubble) {
    return;
  }

  bubble.owner = owner;
  bubble.createdAt = elapsedSeconds;
  bubble.expiresAt = elapsedSeconds + lifetimeSeconds;
  bubble.container.visible = true;
  drawBubble(bubble, text);
  appendDebugBubbleHistory(bubble);
  bubbles.push(bubble);
}

function clearDebugBubbleHistory() {
  if (typeof window !== "undefined") {
    window.__LANTERNWOOD_DEBUG_BUBBLE_HISTORY__ = [];
  }
}

function renderFrozenFrame(
  agents: RunState["agents"],
  sprites: Map<AgentId, AgentSpriteView>,
  positions: PositionMap,
  statusClocks: StatusClockMap,
) {
  const fixedElapsedSeconds = 1.25;
  const settledStatusSeconds = 1.2;

  for (const agent of Object.values(agents)) {
    const view = sprites.get(agent.definition.id);

    if (!view) {
      continue;
    }

    const target = getAgentSceneTarget(agent.definition, agent.status);
    positions[agent.definition.id] = { ...target };
    statusClocks[agent.definition.id] = {
      status: agent.status,
      changedAt: fixedElapsedSeconds - settledStatusSeconds,
    };
    view.container.x = target.x;
    view.container.y = target.y;
    view.container.zIndex = target.y;
    updateAgentSprite(view, agent, fixedElapsedSeconds, false, settledStatusSeconds);
    updateDebugAgent(agent.definition.id, agent.status, target.x, target.y, view.container.zIndex);
  }
}

function SceneContent({ runEpoch = 0, state }: LanternwoodSceneProps) {
  const { app } = useApplication();
  const stateRef = useRef(state);
  const latestRunEpochRef = useRef(0);
  const processedRunEpochRef = useRef(0);
  const spritesRef = useRef<Map<AgentId, AgentSpriteView>>(new Map());
  const positionsRef = useRef<PositionMap | null>(null);
  const statusClocksRef = useRef<StatusClockMap | null>(null);
  const bubblesRef = useRef<BubbleView[]>([]);
  const dispatchTargetRef = useRef<DispatchTarget | null>(null);
  const dispatchQueueRef = useRef<Array<Omit<DispatchTarget, "expiresAt">>>([]);
  const processedTimelineLengthRef = useRef(0);
  const currentTaskIdRef = useRef<string | null>(null);
  const elapsedRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    latestRunEpochRef.current = runEpoch;
  }, [runEpoch]);

  useEffect(() => {
    const stage = app.stage;
    const sprites = spritesRef.current;
    const bubbles = bubblesRef.current;
    const initialPositions = {} as PositionMap;
    const initialStatusClocks = {} as StatusClockMap;

    clearStage(stage);
    sprites.clear();
    bubbles.splice(0);
    Object.assign(stage, { sortableChildren: true });
    stage.addChild(createSceneBackground());

    for (const agent of Object.values(stateRef.current.agents)) {
      const view = createAgentSprite(agent);
      const home = getAgentScenePosition(agent.definition);

      initialPositions[agent.definition.id] = { ...home };
      initialStatusClocks[agent.definition.id] = { status: agent.status, changedAt: elapsedRef.current };
      view.container.x = home.x;
      view.container.y = home.y;
      view.container.zIndex = home.y;
      stage.addChild(view.container);
      sprites.set(agent.definition.id, view);
    }

    for (let index = 0; index < 6; index += 1) {
      const bubble = createBubbleView();
      stage.addChild(bubble.container);
      bubbles.push(bubble);
    }

    positionsRef.current = initialPositions;
    statusClocksRef.current = initialStatusClocks;

    const tick = () => {
      const deltaSeconds = app.ticker.deltaMS / 1000;
      const frozen = isAnimationFrozen();

      if (!frozen) {
        elapsedRef.current += deltaSeconds;
      }

      const agents = stateRef.current.agents;
      const timeline = stateRef.current.timeline;
      const taskId = stateRef.current.currentTask?.taskId ?? null;

      if (
        latestRunEpochRef.current !== processedRunEpochRef.current ||
        taskId !== currentTaskIdRef.current ||
        timeline.length < processedTimelineLengthRef.current
      ) {
        processedRunEpochRef.current = latestRunEpochRef.current;
        currentTaskIdRef.current = taskId;
        processedTimelineLengthRef.current = 0;
        dispatchTargetRef.current = null;
        dispatchQueueRef.current = [];
        const positions = positionsRef.current;
        const statusClocks = statusClocksRef.current;
        if (positions && statusClocks) {
          for (const agent of Object.values(agents)) {
            const home = getAgentScenePosition(agent.definition);
            const view = spritesRef.current.get(agent.definition.id);
            positions[agent.definition.id] = { ...home };
            statusClocks[agent.definition.id] = { status: agent.status, changedAt: elapsedRef.current };
            if (view) {
              view.container.x = home.x;
              view.container.y = home.y;
              view.container.zIndex = home.y;
              updateDebugAgent(agent.definition.id, agent.status, home.x, home.y, view.container.zIndex);
            }
          }
        }
        for (const bubble of bubblesRef.current) {
          bubble.container.visible = false;
          bubble.createdAt = 0;
          bubble.expiresAt = 0;
        }
        clearDebugBubbleHistory();
      }

      for (const event of timeline.slice(processedTimelineLengthRef.current)) {
        const text = bubbleTextFromEvent(event);

        if (event.type === "agent.prompted" && event.payload && text) {
          dispatchQueueRef.current.push({
            recipientAgentId: event.payload.recipientAgentId,
            speechBubble: text,
          });
        }

        if (text && event.type === "agent.reporting") {
          showBubble(bubblesRef.current, event.agentId, text, elapsedRef.current, 3.8);
        }
      }

      processedTimelineLengthRef.current = timeline.length;

      if (!dispatchTargetRef.current || dispatchTargetRef.current.expiresAt <= elapsedRef.current) {
        const nextDispatch = dispatchQueueRef.current.shift();
        dispatchTargetRef.current = nextDispatch
          ? {
              expiresAt: elapsedRef.current + 2.2,
              recipientAgentId: nextDispatch.recipientAgentId,
              speechBubble: nextDispatch.speechBubble,
            }
          : null;

        if (dispatchTargetRef.current) {
          showBubble(
            bubblesRef.current,
            "luma",
            dispatchTargetRef.current.speechBubble,
            elapsedRef.current,
            2.2,
            true,
          );
        }
      }

      if (frozen) {
        if (positionsRef.current && statusClocksRef.current) {
          renderFrozenFrame(agents, spritesRef.current, positionsRef.current, statusClocksRef.current);
        }
        updateDebugBubbles(bubblesRef.current, elapsedRef.current);
        return;
      }

      for (const agent of Object.values(agents)) {
        const view = spritesRef.current.get(agent.definition.id);
        const positions = positionsRef.current;
        const statusClocks = statusClocksRef.current;

        if (!view || !positions || !statusClocks) {
          continue;
        }

        const statusClock = statusClocks[agent.definition.id];
        if (statusClock.status !== agent.status) {
          statusClock.status = agent.status;
          statusClock.changedAt = elapsedRef.current;
        }

        const current = positions[agent.definition.id];
        const dispatchTarget = dispatchTargetRef.current;
        const target =
          agent.definition.id === "luma" && dispatchTarget && dispatchTarget.expiresAt > elapsedRef.current
            ? {
                x: getAgentWorkPosition(dispatchTarget.recipientAgentId).x - 76,
                y: getAgentWorkPosition(dispatchTarget.recipientAgentId).y,
              }
            : getAgentSceneTarget(agent.definition, agent.status);
        const distance = Math.hypot(target.x - current.x, target.y - current.y);
        const isTravelling = distance > 2.5;

        current.x = approach(current.x, target.x, deltaSeconds, 5.4);
        current.y = approach(current.y, target.y, deltaSeconds, 5.4);
        view.container.x = current.x;
        view.container.y = current.y;
        view.container.zIndex = current.y;

        updateAgentSprite(view, agent, elapsedRef.current, isTravelling, elapsedRef.current - statusClock.changedAt);
        updateDebugAgent(agent.definition.id, agent.status, current.x, current.y, view.container.zIndex);
      }

      for (const bubble of bubblesRef.current) {
        const ownerPosition = positionsRef.current?.[bubble.owner];
        bubble.container.visible = Boolean(ownerPosition && bubble.expiresAt > elapsedRef.current);

        if (ownerPosition && bubble.container.visible) {
          bubble.container.x = Math.max(12, Math.min(SCENE_SIZE.width - 250, ownerPosition.x - 80));
          bubble.container.y = Math.max(16, ownerPosition.y - 118);
          bubble.container.zIndex = ownerPosition.y + 1_000;
        }
      }

      updateDebugBubbles(bubblesRef.current, elapsedRef.current);
    };

    app.ticker.add(tick);

    return () => {
      app.ticker.remove(tick);
      clearStage(stage);
      sprites.clear();
      bubbles.splice(0);
      positionsRef.current = null;
      statusClocksRef.current = null;
      processedTimelineLengthRef.current = 0;
    };
  }, [app]);

  return null;
}

export function LanternwoodScene({ runEpoch = 0, state }: LanternwoodSceneProps) {
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
      <SceneContent runEpoch={runEpoch} state={state} />
    </Application>
  );
}
