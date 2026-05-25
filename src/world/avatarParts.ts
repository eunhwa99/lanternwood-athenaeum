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

function hex(color: string): number {
  return Number.parseInt(color.replace("#", ""), 16);
}

function darker(color: string): number {
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
  const hood = new Graphics().arc(0, -32, 21, Math.PI, Math.PI * 2).stroke({ color: darkColor, width: 10, alpha: 0.98 });
  const leftEye = new Graphics().circle(0, 0, 2).fill({ color: 0x1d2020 });
  const rightEye = new Graphics().circle(0, 0, 2).fill({ color: 0x1d2020 });
  const smile = new Graphics().arc(0, -28, 6, 0.15, Math.PI - 0.15).stroke({ color: 0x5b3b34, width: 1, alpha: 0.8 });

  leftEye.position.set(-6, -33);
  rightEye.position.set(6, -33);
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

function drawAgentProp(container: Container, agent: AgentDefinition): void {
  if (agent.id === "orion") {
    const spyglass = new Graphics().circle(0, 0, 8).stroke({ color: 0xd7f3ff, width: 2 }).moveTo(-14, 8).lineTo(8, -10).stroke({
      color: 0xd7f3ff,
      width: 2,
    });
    container.addChild(spyglass);
    return;
  }

  if (agent.id === "neria") {
    container.addChild(new Graphics().roundRect(-8, -10, 18, 24, 4).fill({ color: 0xe7d6a3 }).stroke({ color: 0x8f7651, width: 1 }));
    return;
  }

  if (agent.id === "quill") {
    container.addChild(new Graphics().moveTo(-8, 12).lineTo(12, -14).stroke({ color: 0xf7ead0, width: 3 }).ellipse(12, -16, 5, 12).fill({
      color: 0xf0d6ff,
    }));
    return;
  }

  if (agent.id === "argus") {
    container.addChild(new Graphics().circle(0, 0, 9).fill({ color: 0xf2c66d, alpha: 0.75 }).stroke({ color: 0xfff1b8, width: 2 }));
    return;
  }

  container.addChild(new Graphics().roundRect(-9, -12, 20, 22, 4).fill({ color: 0x6a5035 }).stroke({ color: 0xf2c66d, width: 2 }));
}
