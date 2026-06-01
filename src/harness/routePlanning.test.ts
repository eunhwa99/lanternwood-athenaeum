import { describe, expect, it } from "vitest";
import { AGENTS } from "../agents/registry";
import type { AgentDefinition } from "../agents/types";
import { planRoute } from "./routePlanning";

const route = (input: string, agents: AgentDefinition[] = AGENTS) => planRoute(input, agents);

describe("planRoute", () => {
  it("selects Orion and Argus for technical analysis with review risk", () => {
    expect(route("Review this code and verify the risky edge cases")).toMatchObject({
      selectedAgentIds: ["orion", "argus"],
      skippedAgentIds: ["neria", "quill"],
    });
  });

  it("selects no specialists for simple low-risk questions", () => {
    expect(route("What is Luma?")).toMatchObject({
      confidence: "high",
      selectedAgentIds: [],
      skippedAgentIds: ["orion", "neria", "quill", "argus"],
    });
    expect(route("Can you explain Luma?").selectedAgentIds).toEqual([]);
    expect(route("Please explain Luma").selectedAgentIds).toEqual([]);
    expect(route("Can you tell me what Luma is?").selectedAgentIds).toEqual([]);
    expect(route("Can you briefly explain Luma?").selectedAgentIds).toEqual([]);
    expect(route("Please briefly explain Luma").selectedAgentIds).toEqual([]);
    expect(route("Can you give me a short explanation of Luma?").selectedAgentIds).toEqual([]);
    expect(route("What is a run?").selectedAgentIds).toEqual([]);
    expect(route("What is a shell?").selectedAgentIds).toEqual([]);
    expect(route("What is a command?").selectedAgentIds).toEqual([]);
    expect(route("What is a README?").selectedAgentIds).toEqual([]);
    expect(route("What are docs?").selectedAgentIds).toEqual([]);
    expect(route("What is code?").selectedAgentIds).toEqual([]);
    expect(route("What is a plan?").selectedAgentIds).toEqual([]);
    expect(route("Should I run npm test?").selectedAgentIds).toEqual([]);
    expect(route("Do I need to run npm test?").selectedAgentIds).toEqual([]);
    expect(route("Which command should I run?").selectedAgentIds).toEqual([]);
    expect(route("Which command should I run").selectedAgentIds).toEqual([]);
  });

  it("selects Neria for previous-run context", () => {
    expect(route("방금 질문에 대해 어떤 agent한테 일 시켰어?").selectedAgentIds).toContain("neria");
    expect(route("explain the historical context of this library").selectedAgentIds).not.toContain("neria");
    expect(route("give me context on this library").selectedAgentIds).not.toContain("neria");
    expect(route("summarize the previous paragraph").selectedAgentIds).not.toContain("neria");
    expect(route("React 역사와 맥락 설명해줘").selectedAgentIds).not.toContain("neria");
    expect(route("역사적 맥락 설명해줘").selectedAgentIds).not.toContain("neria");
    expect(route("create an Obsidian note").selectedAgentIds).not.toContain("neria");
    expect(route("write an Obsidian note").selectedAgentIds).not.toContain("neria");
    expect(route("write docs about memory management in Java").selectedAgentIds).not.toContain("neria");
    expect(route("write a follow-up email").selectedAgentIds).not.toContain("neria");
    expect(route("draft follow-up notes").selectedAgentIds).not.toContain("neria");
    expect(route("Compare JVM memory model and Go memory model").selectedAgentIds).not.toContain("neria");
    expect(route("Brainstorm memory workshop ideas").selectedAgentIds).not.toContain("neria");
    expect(route("Give me historical context on memory management").selectedAgentIds).not.toContain("neria");
    expect(route("use previous context from the last run").selectedAgentIds).toContain("neria");
    expect(route("What did the previous run do?").selectedAgentIds).toContain("neria");
    expect(route("explain previous run").selectedAgentIds).toContain("neria");
    expect(route("How did the previous run use README docs?").selectedAgentIds).toEqual(["neria"]);
    expect(route("use Obsidian memory context").selectedAgentIds).toContain("neria");
    expect(route("user persona design tips").selectedAgentIds).not.toContain("neria");
    expect(route("페르소나 설계 팁").selectedAgentIds).not.toContain("neria");
    expect(route("선호도 조사 방법").selectedAgentIds).not.toContain("neria");
  });

  it("selects Orion for Korean current fact-check and code exploration requests", () => {
    expect(route("최신 정보랑 코드 문서 탐색해서 사실 확인해줘").selectedAgentIds).toContain("orion");
  });

  it("selects Quill without Argus for low-risk writing requests", () => {
    expect(route("write a README outline").selectedAgentIds).toEqual(["quill"]);
    expect(route("write docs").selectedAgentIds).toEqual(["quill"]);
    expect(route("README 계획 만들어줘").selectedAgentIds).toEqual(["quill"]);
    expect(route("summarize this file").selectedAgentIds).toEqual(["quill"]);
    expect(route("edit this paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(route("review this paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(route("review README wording").selectedAgentIds).toEqual(["quill"]);
    expect(route("review the docs").selectedAgentIds).toEqual(["quill"]);
    expect(route("docs review").selectedAgentIds).toEqual(["quill"]);
    expect(route("문서 누락 검토해줘").selectedAgentIds).toEqual(["quill"]);
    expect(route("문단 누락 검토해줘").selectedAgentIds).toEqual(["quill"]);
    expect(route("이 글 검토해줘").selectedAgentIds).toEqual(["quill"]);
    expect(route("analysis of this paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(route("review the quality of this paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(route("improve the quality of this paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(route("technical prose review").selectedAgentIds).toEqual(["quill"]);
    expect(route("write a technical paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(route("technical writing tips").selectedAgentIds).toEqual(["quill"]);
    expect(route("문단 검토해줘").selectedAgentIds).toEqual(["quill"]);
    expect(route("README 문장 검토해줘").selectedAgentIds).toEqual(["quill"]);
    expect(route("revise this paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(route("proofread this sentence").selectedAgentIds).toEqual(["quill"]);
    expect(route("improve this sentence").selectedAgentIds).toEqual(["quill"]);
    expect(route("rewrite this paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(route("make this more concise").selectedAgentIds).toEqual(["quill"]);
    expect(route("make this clearer").selectedAgentIds).toEqual(["quill"]);
    expect(route("make this profile stronger").selectedAgentIds).toEqual(["quill"]);
    expect(route("write a profile").selectedAgentIds).toEqual(["quill"]);
    expect(route("edit this profile").selectedAgentIds).toEqual(["quill"]);
    expect(route("patch this paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(route("write a summary of this file").selectedAgentIds).toEqual(["quill"]);
    expect(route("write about this file").selectedAgentIds).toEqual(["quill"]);
    expect(route("write a long profile").selectedAgentIds).toEqual(["quill"]);
    expect(route("write a long paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(route("write the final paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(route("make the final paragraph clearer").selectedAgentIds).toEqual(["quill"]);
    expect(route("최종 문단 써줘").selectedAgentIds).toEqual(["quill"]);
    expect(route("최종 문단을 더 명확하게 해줘").selectedAgentIds).toEqual(["quill"]);
    expect(route("write a long profile ".repeat(15))).toMatchObject({
      confidence: "medium",
      selectedAgentIds: ["quill"],
    });
    expect(route("summarize this source file ".repeat(20))).toMatchObject({
      confidence: "medium",
      selectedAgentIds: ["orion", "quill"],
    });
  });

  it("selects Argus for permission and file-create intents", () => {
    expect(route("Create an Obsidian note for this plan").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(route("파일 쓰기 권한 확인하고 새 노트 만들어줘").selectedAgentIds).toContain("argus");
    expect(route("write a file").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(route("write a new file").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(route("create a new file").selectedAgentIds).toEqual(["argus"]);
    expect(route("write the new file").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(route("file-write this output").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(route("edit README.md").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(route("patch src/app.ts").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(route("modify package.json").selectedAgentIds).toEqual(["argus"]);
    expect(route("write README.md").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(route("update the README").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(route("modify README").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(route("create docs/plan.md").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(route("change README.md").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(route("write src/app.ts").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(route("edit Dockerfile").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(route("patch scripts/build").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(route("edit .gitignore").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(route("patch .gitignore").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(route("run npm test").selectedAgentIds).toEqual(["argus"]);
    expect(route("please run tests").selectedAgentIds).toEqual(["argus"]);
    expect(route("run ls").selectedAgentIds).toEqual(["argus"]);
    expect(route("execute pwd").selectedAgentIds).toEqual(["argus"]);
    expect(route("run make").selectedAgentIds).toEqual(["argus"]);
    expect(route("please use shell to list files").selectedAgentIds).toEqual(["argus"]);
    expect(route("call an external command").selectedAgentIds).toEqual(["argus"]);
    expect(route("external shell command").selectedAgentIds).toEqual(["argus"]);
    expect(route("git status").selectedAgentIds).toEqual(["argus"]);
    expect(route("please use git status").selectedAgentIds).toEqual(["argus"]);
    expect(route("call curl -I example.com").selectedAgentIds).toEqual(["argus"]);
    expect(route("execute shell command").selectedAgentIds).toEqual(["argus"]);
  });

  it("selects Argus for code-change intents", () => {
    expect(route("Brainstorm workshop ideas").selectedAgentIds).toEqual([]);
    expect(route("compare React and Vue").selectedAgentIds).toEqual([]);
    expect(route("give me context on this topic").selectedAgentIds).toEqual([]);
    expect(route("historical context of this library").selectedAgentIds).toEqual([]);
    expect(route("risk management overview").selectedAgentIds).toEqual([]);
    expect(route("permission systems overview").selectedAgentIds).toEqual([]);
    expect(route("code review patterns").selectedAgentIds).toEqual([]);
    expect(route("review code review patterns").selectedAgentIds).toEqual([]);
    expect(route("review permission systems").selectedAgentIds).toEqual([]);
    expect(route("Brainstorm risk workshop ideas").selectedAgentIds).toEqual([]);
    expect(route("compare risk management frameworks").selectedAgentIds).toEqual([]);
    expect(route("fix this bug in code").selectedAgentIds).toEqual(["orion", "argus"]);
    expect(route("change code").selectedAgentIds).toEqual(["orion", "argus"]);
    expect(route("patch this code").selectedAgentIds).toEqual(["orion", "quill", "argus"]);
    expect(route("코드 수정해줘").selectedAgentIds).toEqual(["orion", "argus"]);
    expect(route("review the final answer").selectedAgentIds).toEqual(["argus"]);
  });

  it("keeps broad implementation prompts in the visible specialist workflow", () => {
    expect(route("이 앱에 task를 입력하면 코드 생성 기능을 구현해줘").selectedAgentIds).toEqual(["orion", "quill", "argus"]);
    expect(route("Build a new feature that creates files and verifies the result").selectedAgentIds).toEqual([
      "orion",
      "quill",
      "argus",
    ]);
    expect(route("Make this app generate code in the selected workspace").selectedAgentIds).toEqual(["orion", "quill", "argus"]);
  });

  it("routes to custom specialists from agent definition metadata", () => {
    const customAgents: AgentDefinition[] = [
      AGENTS.find((agent) => agent.id === "luma")!,
      {
        color: "#7AA2F7",
        displayName: "Build Scribe",
        futureTools: [],
        homePosition: { x: 520, y: 300 },
        id: "build-scribe",
        persona: "Implementation agent",
        promptInstruction: "Inspect implementation tasks and return build notes.",
        routing: {
          keywords: ["scaffold widget", "build-note"],
          reason: "custom implementation notes",
        },
        systemRole: "ResearchAgent",
        worldRole: "Workshop steward",
      },
    ];

    expect(route("Please scaffold widget controls", customAgents)).toMatchObject({
      rationale: "The request needs custom implementation notes.",
      selectedAgentIds: ["build-scribe"],
      skippedAgentIds: [],
    });
  });
});