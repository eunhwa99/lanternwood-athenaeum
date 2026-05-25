import { Application, extend, useApplication } from "@pixi/react";
import { Container, Graphics, Text } from "pixi.js";
import { useEffect, useRef } from "react";
import type { AgentId } from "../agents/types";
import type { AgentStatus, RunState } from "../events/types";
import { createAgentSprite, updateAgentSprite, type AgentSpriteView } from "./AgentSprite";
import { approach, getAgentSceneTarget } from "./avatarAnimation";
import { createSceneBackground } from "./sceneBackground";
import { SCENE_SIZE, getAgentScenePosition } from "./sceneLayout";

extend({ Container, Graphics, Text });

type LanternwoodSceneProps = {
  state: RunState;
};

type PositionMap = Record<AgentId, { x: number; y: number }>;
type StatusClockMap = Record<AgentId, { status: AgentStatus; changedAt: number }>;

declare global {
  interface Window {
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
    updateAgentSprite(view, agent, fixedElapsedSeconds, false, settledStatusSeconds);
  }
}

function SceneContent({ state }: LanternwoodSceneProps) {
  const { app } = useApplication();
  const stateRef = useRef(state);
  const spritesRef = useRef<Map<AgentId, AgentSpriteView>>(new Map());
  const positionsRef = useRef<PositionMap | null>(null);
  const statusClocksRef = useRef<StatusClockMap | null>(null);
  const elapsedRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const stage = app.stage;
    const sprites = spritesRef.current;
    const initialPositions = {} as PositionMap;
    const initialStatusClocks = {} as StatusClockMap;

    clearStage(stage);
    sprites.clear();
    stage.addChild(createSceneBackground());

    for (const agent of Object.values(stateRef.current.agents)) {
      const view = createAgentSprite(agent);
      const home = getAgentScenePosition(agent.definition);

      initialPositions[agent.definition.id] = { ...home };
      initialStatusClocks[agent.definition.id] = { status: agent.status, changedAt: elapsedRef.current };
      view.container.x = home.x;
      view.container.y = home.y;
      stage.addChild(view.container);
      sprites.set(agent.definition.id, view);
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

      if (frozen) {
        if (positionsRef.current && statusClocksRef.current) {
          renderFrozenFrame(agents, spritesRef.current, positionsRef.current, statusClocksRef.current);
        }
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
        const target = getAgentSceneTarget(agent.definition, agent.status);
        const distance = Math.hypot(target.x - current.x, target.y - current.y);
        const isTravelling = distance > 2.5;

        current.x = approach(current.x, target.x, deltaSeconds, 4.8);
        current.y = approach(current.y, target.y, deltaSeconds, 4.8);
        view.container.x = current.x;
        view.container.y = current.y;

        updateAgentSprite(view, agent, elapsedRef.current, isTravelling, elapsedRef.current - statusClock.changedAt);
      }
    };

    app.ticker.add(tick);

    return () => {
      app.ticker.remove(tick);
      clearStage(stage);
      sprites.clear();
      positionsRef.current = null;
      statusClocksRef.current = null;
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
