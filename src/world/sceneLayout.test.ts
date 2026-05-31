import { describe, expect, it } from "vitest";
import { AGENTS } from "../agents/registry";
import { getAgentBubblePosition, getAgentReportPosition, getAgentScenePosition, getAgentWorkPosition } from "./sceneLayout";

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

  it("creates deterministic fallback positions for dynamically authored agents", () => {
    const workPosition = getAgentWorkPosition("build-scribe");
    const reportPosition = getAgentReportPosition("build-scribe");
    const bubblePosition = getAgentBubblePosition("build-scribe", reportPosition);

    expect(getAgentWorkPosition("build-scribe")).toEqual(workPosition);
    expect(workPosition.x).toBeGreaterThanOrEqual(0);
    expect(workPosition.x).toBeLessThanOrEqual(960);
    expect(reportPosition.y).toBeGreaterThanOrEqual(0);
    expect(reportPosition.y).toBeLessThanOrEqual(620);
    expect(bubblePosition.x).toBeGreaterThanOrEqual(12);
  });

  it("keeps report speech bubbles from overlapping at the central desk", () => {
    const specialists = AGENTS.filter((agent) => agent.id !== "luma");
    const boxes = specialists.map((agent) => {
      const position = getAgentBubblePosition(agent.id, getAgentReportPosition(agent.id));

      return {
        agentId: agent.id,
        height: 82,
        width: 250,
        x: position.x,
        y: position.y,
      };
    });

    for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
        const left = boxes[leftIndex];
        const right = boxes[rightIndex];
        const overlaps =
          left.x < right.x + right.width &&
          left.x + left.width > right.x &&
          left.y < right.y + right.height &&
          left.y + left.height > right.y;

        expect(overlaps, `${left.agentId}/${right.agentId}`).toBe(false);
      }
    }
  });
});