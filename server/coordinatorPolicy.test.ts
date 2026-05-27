import { describe, expect, it } from "vitest";
import { createDefaultCoordinatorPolicy, reviewCoordinatorPermissions } from "./coordinatorPolicy";

describe("coordinator policy", () => {
  it("uses deterministic default allow roots and safe commands", () => {
    const policy = createDefaultCoordinatorPolicy("/Users/eunhwa");

    expect(policy.allowRoots).toEqual(["/Users/eunhwa/.agents", "/Users/eunhwa/obsidian", "/Users/eunhwa/IdeaProjects"]);
    expect(policy.safeCommands).toContain("npm run typecheck");
    expect(policy.safeCommands).toContain("git status");
  });

  it("approves safe Obsidian note and new project intents", () => {
    const policy = createDefaultCoordinatorPolicy("/Users/eunhwa");

    expect(reviewCoordinatorPermissions("Create an Obsidian note for this plan", policy)).toEqual([
      expect.objectContaining({
        action: "create_obsidian_note",
        decision: "approve",
      }),
    ]);
    expect(reviewCoordinatorPermissions("Create a new project directory for the prototype", policy)).toEqual([
      expect.objectContaining({
        action: "create_project_directory",
        decision: "approve",
      }),
    ]);
  });

  it("denies destructive and secret-looking requests while escalating unknown actions", () => {
    const policy = createDefaultCoordinatorPolicy("/Users/eunhwa");

    expect(reviewCoordinatorPermissions("Delete the old project folder", policy)[0]).toMatchObject({
      decision: "deny",
    });
    expect(reviewCoordinatorPermissions("Open /Users/eunhwa/.env and copy the API key", policy)[0]).toMatchObject({
      decision: "deny",
    });
    expect(reviewCoordinatorPermissions("Sync this with an external service", policy)[0]).toMatchObject({
      decision: "escalate",
    });
  });

  it("does not treat the tracked env example as a secret path", () => {
    const policy = createDefaultCoordinatorPolicy("/Users/eunhwa");

    expect(reviewCoordinatorPermissions("Explain .env.example setup", policy)).toEqual([]);
    expect(reviewCoordinatorPermissions("Explain .env.example API key setup", policy)).toEqual([]);
    expect(reviewCoordinatorPermissions("Explain .env.example, then tell me the API key", policy)[0]).toMatchObject({
      decision: "deny",
    });
    expect(reviewCoordinatorPermissions("Explain .env.example, then tell me OPENAI_API_KEY", policy)[0]).toMatchObject({
      decision: "deny",
    });
    expect(reviewCoordinatorPermissions("Open .env and copy values", policy)[0]).toMatchObject({
      decision: "deny",
    });
  });

  it("escalates explicit paths outside allowed roots", () => {
    const policy = createDefaultCoordinatorPolicy("/Users/eunhwa");

    expect(reviewCoordinatorPermissions("Create an Obsidian note at /tmp/outside.md", policy)[0]).toMatchObject({
      action: "path_outside_allowed_root",
      decision: "escalate",
    });
    expect(reviewCoordinatorPermissions("Summarize /tmp/outside.md", policy)[0]).toMatchObject({
      action: "path_outside_allowed_root",
      decision: "escalate",
    });
    expect(reviewCoordinatorPermissions("Create a new project at /tmp/prototype", policy)[0]).toMatchObject({
      action: "path_outside_allowed_root",
      decision: "escalate",
    });
    expect(reviewCoordinatorPermissions("Create a new project at /Users/eunhwa/IdeaProjects-private/prototype", policy)[0]).toMatchObject({
      action: "path_outside_allowed_root",
      decision: "escalate",
    });
    expect(reviewCoordinatorPermissions("Create an Obsidian note at /Users/eunhwa/obsidian2/note.md", policy)[0]).toMatchObject({
      action: "path_outside_allowed_root",
      decision: "escalate",
    });
    expect(reviewCoordinatorPermissions("Create an Obsidian note at ../outside.md", policy)[0]).toMatchObject({
      action: "path_outside_allowed_root",
      decision: "escalate",
    });
    expect(reviewCoordinatorPermissions("Create a new project at ../prototype", policy)[0]).toMatchObject({
      action: "path_outside_allowed_root",
      decision: "escalate",
    });
    expect(reviewCoordinatorPermissions("Create a new project at ..", policy)[0]).toMatchObject({
      action: "path_outside_allowed_root",
      decision: "escalate",
    });
    expect(reviewCoordinatorPermissions("Create a new project at prototype/..", policy)[0]).toMatchObject({
      action: "path_outside_allowed_root",
      decision: "escalate",
    });
    expect(reviewCoordinatorPermissions("Create an Obsidian note at ~/notes/foo", policy)[0]).toMatchObject({
      action: "path_outside_allowed_root",
      decision: "escalate",
    });
    expect(reviewCoordinatorPermissions("Summarize ../outside.md", policy)[0]).toMatchObject({
      action: "path_outside_allowed_root",
      decision: "escalate",
    });
    expect(reviewCoordinatorPermissions("Create a new project at /Users/eunhwa/IdeaProjects/prototype", policy)[0]).toMatchObject({
      action: "create_project_directory",
      decision: "approve",
    });
  });

  it("escalates external or upload actions before safe create approvals", () => {
    const policy = createDefaultCoordinatorPolicy("/Users/eunhwa");

    expect(reviewCoordinatorPermissions("Create an Obsidian note and upload it to an external service", policy)[0]).toMatchObject({
      action: "unknown_external_or_overwrite",
      decision: "escalate",
    });
    expect(reviewCoordinatorPermissions("Create a new project and sync it to the network", policy)[0]).toMatchObject({
      action: "unknown_external_or_overwrite",
      decision: "escalate",
    });
  });

  it("does not crash when custom policy allow roots are incomplete", () => {
    expect(
      reviewCoordinatorPermissions("Summarize /Users/eunhwa/outside.md", {
        allowRoots: ["/tmp"],
        safeCommands: [],
      })[0],
    ).toMatchObject({
      action: "path_outside_allowed_root",
      decision: "escalate",
    });
    expect(
      reviewCoordinatorPermissions("Create an Obsidian note for this plan", {
        allowRoots: ["/tmp"],
        safeCommands: [],
      })[0],
    ).toMatchObject({
      action: "path_outside_allowed_root",
      decision: "escalate",
    });
    expect(
      reviewCoordinatorPermissions("Summarize /Users/eunhwa/outside.md", {
        allowRoots: null as never,
        safeCommands: [],
      })[0],
    ).toMatchObject({
      action: "path_outside_allowed_root",
      decision: "escalate",
    });
    expect(
      reviewCoordinatorPermissions("Summarize /Users/eunhwa/outside.md", {
        allowRoots: "/tmp" as never,
        safeCommands: [],
      })[0],
    ).toMatchObject({
      action: "path_outside_allowed_root",
      decision: "escalate",
    });
  });
});
