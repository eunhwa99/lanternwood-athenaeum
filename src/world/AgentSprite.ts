import { Container, Graphics, Text } from "pixi.js";
import type { AgentRuntimeState } from "../events/types";

export function createAgentSprite(agent: AgentRuntimeState): Container {
  const container = new Container();
  const ring = new Graphics()
    .circle(0, 0, 28)
    .fill({ color: agent.definition.color })
    .stroke({ color: 0xf7ead0, width: 2, alpha: 0.8 });
  const label = new Text({
    text: agent.definition.displayName.slice(0, 2),
    style: {
      fill: "#13201d",
      fontSize: 14,
      fontWeight: "700",
    },
  });

  label.anchor.set(0.5);
  container.addChild(ring, label);

  return container;
}
