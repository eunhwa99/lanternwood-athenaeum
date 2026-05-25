import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../events/types";
import { renderApp } from "../test/render";
import { Timeline } from "./Timeline";

const events: AgentEvent[] = [
  {
    eventId: "evt-1",
    taskId: "task-1",
    agentId: "luma",
    type: "task.created",
    message: "Draft my weekly plan",
    timestamp: "2026-05-25T00:00:00.000Z",
  },
  {
    eventId: "evt-2",
    taskId: "task-1",
    agentId: "orion",
    type: "agent.working",
    message: "Orion studies the star maps",
    timestamp: "2026-05-25T00:00:01.000Z",
  },
];

describe("Timeline", () => {
  it("renders event messages in order", () => {
    renderApp(<Timeline events={events} />);

    expect(screen.getByText("Draft my weekly plan")).toBeInTheDocument();
    expect(screen.getByText("Orion studies the star maps")).toBeInTheDocument();
  });
});
