import { Application, extend, useApplication } from "@pixi/react";
import { Container, Graphics, Text } from "pixi.js";
import { useEffect } from "react";
import type { RunState } from "../events/types";
import { createAgentSprite } from "./AgentSprite";
import { CENTRAL_DESK, HOME_POSITIONS, SCENE_SIZE } from "./sceneLayout";

extend({ Container, Graphics, Text });

type LanternwoodSceneProps = {
  state: RunState;
};

function clearStage(stage: Container) {
  for (const child of stage.removeChildren()) {
    child.destroy({ children: true });
  }
}

function SceneContent({ state }: LanternwoodSceneProps) {
  const { app } = useApplication();

  useEffect(() => {
    const stage = app.stage;

    clearStage(stage);

    const background = new Graphics()
      .roundRect(20, 20, SCENE_SIZE.width - 40, SCENE_SIZE.height - 40, 18)
      .fill({ color: 0x1f362f })
      .stroke({ color: 0xd8c781, width: 2, alpha: 0.45 });

    const desk = new Graphics()
      .ellipse(CENTRAL_DESK.x, CENTRAL_DESK.y + 10, 92, 48)
      .fill({ color: 0x6a5035 })
      .stroke({ color: 0xf2c66d, width: 2, alpha: 0.5 });

    stage.addChild(background, desk);

    for (const agent of Object.values(state.agents)) {
      const sprite = createAgentSprite(agent);
      const home = HOME_POSITIONS[agent.definition.id];

      sprite.x = home.x;
      sprite.y = home.y;
      sprite.alpha = agent.status === "idle" ? 0.72 : 1;
      stage.addChild(sprite);
    }

    return () => {
      clearStage(stage);
    };
  }, [app, state]);

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
