import { describe, expect, it } from "vitest";
import { createSceneBackground } from "./sceneBackground";

describe("scene background", () => {
  it("creates a layered Lanternwood library background", () => {
    const background = createSceneBackground();

    expect(background.children.length).toBeGreaterThan(50);
  });
});
