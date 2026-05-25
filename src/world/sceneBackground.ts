import { Container, Graphics } from "pixi.js";
import { CENTRAL_DESK, SCENE_SIZE } from "./sceneLayout";

export function createSceneBackground(): Container {
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

function drawShelves(root: Container, x: number, y: number, width: number, height: number): void {
  const shelf = new Graphics()
    .roundRect(x, y, width, height, 8)
    .fill({ color: 0x3e2f29 })
    .stroke({ color: 0x9f7d4d, width: 2, alpha: 0.65 });
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

function drawWindow(root: Container): void {
  const frame = new Graphics()
    .roundRect(362, 72, 236, 150, 28)
    .fill({ color: 0x0f171b })
    .stroke({ color: 0xd8c781, width: 3, alpha: 0.6 });
  const moon = new Graphics().circle(544, 112, 18).fill({ color: 0xf7ead0, alpha: 0.85 });
  root.addChild(frame, moon);

  for (let index = 0; index < 18; index += 1) {
    const x = 384 + ((index * 37) % 190);
    const y = 92 + ((index * 23) % 104);
    root.addChild(new Graphics().circle(x, y, 1.5 + (index % 2)).fill({ color: 0xf2c66d, alpha: 0.75 }));
  }

  root.addChild(new Graphics().moveTo(480, 72).lineTo(480, 222).stroke({ color: 0xd8c781, width: 2, alpha: 0.45 }));
  root.addChild(new Graphics().moveTo(362, 148).lineTo(598, 148).stroke({ color: 0xd8c781, width: 2, alpha: 0.45 }));
}

function drawDesk(root: Container): void {
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

function drawFloatingPages(root: Container): void {
  for (let index = 0; index < 8; index += 1) {
    const x = 310 + ((index * 73) % 340);
    const y = 250 + ((index * 31) % 140);
    root.addChild(
      new Graphics().roundRect(x, y, 18, 12, 2).fill({ color: 0xf7ead0, alpha: 0.38 }).stroke({ color: 0xe4b969, width: 1, alpha: 0.35 }),
    );
  }
}
