import { describe, expect, it } from "vitest";
import { planRoute } from "./routePlanning";

describe("planRoute", () => {
  it("selects Orion and Argus for technical analysis with review risk", () => {
    expect(planRoute("Review this code and verify the risky edge cases")).toMatchObject({
      selectedAgentIds: ["orion", "argus"],
      skippedAgentIds: ["neria", "quill"],
    });
  });

  it("selects no specialists for simple low-risk questions", () => {
    expect(planRoute("What is Luma?")).toMatchObject({
      confidence: "high",
      selectedAgentIds: [],
      skippedAgentIds: ["orion", "neria", "quill", "argus"],
    });
    expect(planRoute("Can you explain Luma?").selectedAgentIds).toEqual([]);
    expect(planRoute("Please explain Luma").selectedAgentIds).toEqual([]);
    expect(planRoute("Can you tell me what Luma is?").selectedAgentIds).toEqual([]);
    expect(planRoute("Can you briefly explain Luma?").selectedAgentIds).toEqual([]);
    expect(planRoute("Please briefly explain Luma").selectedAgentIds).toEqual([]);
    expect(planRoute("Can you give me a short explanation of Luma?").selectedAgentIds).toEqual([]);
    expect(planRoute("What is a run?").selectedAgentIds).toEqual([]);
    expect(planRoute("What is a shell?").selectedAgentIds).toEqual([]);
    expect(planRoute("What is a command?").selectedAgentIds).toEqual([]);
    expect(planRoute("What is a README?").selectedAgentIds).toEqual([]);
    expect(planRoute("What are docs?").selectedAgentIds).toEqual([]);
    expect(planRoute("What is code?").selectedAgentIds).toEqual([]);
    expect(planRoute("What is a plan?").selectedAgentIds).toEqual([]);
    expect(planRoute("Should I run npm test?").selectedAgentIds).toEqual([]);
    expect(planRoute("Do I need to run npm test?").selectedAgentIds).toEqual([]);
    expect(planRoute("Which command should I run?").selectedAgentIds).toEqual([]);
    expect(planRoute("Which command should I run").selectedAgentIds).toEqual([]);
  });

  it("selects Neria for previous-run context", () => {
    expect(planRoute("방금 질문에 대해 어떤 agent한테 일 시켰어?").selectedAgentIds).toContain("neria");
    expect(planRoute("explain the historical context of this library").selectedAgentIds).not.toContain("neria");
    expect(planRoute("give me context on this library").selectedAgentIds).not.toContain("neria");
    expect(planRoute("summarize the previous paragraph").selectedAgentIds).not.toContain("neria");
    expect(planRoute("React 역사와 맥락 설명해줘").selectedAgentIds).not.toContain("neria");
    expect(planRoute("역사적 맥락 설명해줘").selectedAgentIds).not.toContain("neria");
    expect(planRoute("create an Obsidian note").selectedAgentIds).not.toContain("neria");
    expect(planRoute("write an Obsidian note").selectedAgentIds).not.toContain("neria");
    expect(planRoute("write docs about memory management in Java").selectedAgentIds).not.toContain("neria");
    expect(planRoute("write a follow-up email").selectedAgentIds).not.toContain("neria");
    expect(planRoute("draft follow-up notes").selectedAgentIds).not.toContain("neria");
    expect(planRoute("Compare JVM memory model and Go memory model").selectedAgentIds).not.toContain("neria");
    expect(planRoute("Brainstorm memory workshop ideas").selectedAgentIds).not.toContain("neria");
    expect(planRoute("Give me historical context on memory management").selectedAgentIds).not.toContain("neria");
    expect(planRoute("use previous context from the last run").selectedAgentIds).toContain("neria");
    expect(planRoute("What did the previous run do?").selectedAgentIds).toContain("neria");
    expect(planRoute("explain previous run").selectedAgentIds).toContain("neria");
    expect(planRoute("How did the previous run use README docs?").selectedAgentIds).toEqual(["neria"]);
    expect(planRoute("use Obsidian memory context").selectedAgentIds).toContain("neria");
    expect(planRoute("user persona design tips").selectedAgentIds).not.toContain("neria");
    expect(planRoute("페르소나 설계 팁").selectedAgentIds).not.toContain("neria");
    expect(planRoute("선호도 조사 방법").selectedAgentIds).not.toContain("neria");
  });

  it("selects Orion for Korean current fact-check and code exploration requests", () => {
    expect(planRoute("최신 정보랑 코드 문서 탐색해서 사실 확인해줘").selectedAgentIds).toContain("orion");
  });

  it("selects Quill without Argus for low-risk writing requests", () => {
    expect(planRoute("write a README outline").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("write docs").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("README 계획 만들어줘").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("summarize this file").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("edit this paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("review this paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("review README wording").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("review the docs").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("docs review").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("문서 누락 검토해줘").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("문단 누락 검토해줘").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("이 글 검토해줘").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("analysis of this paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("review the quality of this paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("improve the quality of this paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("technical prose review").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("write a technical paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("technical writing tips").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("문단 검토해줘").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("README 문장 검토해줘").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("revise this paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("proofread this sentence").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("improve this sentence").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("rewrite this paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("make this more concise").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("make this clearer").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("make this profile stronger").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("write a profile").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("edit this profile").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("patch this paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("write a summary of this file").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("write about this file").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("write a long profile").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("write a long paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("write the final paragraph").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("make the final paragraph clearer").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("최종 문단 써줘").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("최종 문단을 더 명확하게 해줘").selectedAgentIds).toEqual(["quill"]);
    expect(planRoute("write a long profile ".repeat(15))).toMatchObject({
      confidence: "medium",
      selectedAgentIds: ["quill"],
    });
    expect(planRoute("summarize this source file ".repeat(20))).toMatchObject({
      confidence: "medium",
      selectedAgentIds: ["orion", "quill"],
    });
  });

  it("selects Argus for permission and file-create intents", () => {
    expect(planRoute("Create an Obsidian note for this plan").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(planRoute("파일 쓰기 권한 확인하고 새 노트 만들어줘").selectedAgentIds).toContain("argus");
    expect(planRoute("write a file").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(planRoute("write a new file").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(planRoute("create a new file").selectedAgentIds).toEqual(["argus"]);
    expect(planRoute("write the new file").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(planRoute("file-write this output").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(planRoute("edit README.md").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(planRoute("patch src/app.ts").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(planRoute("modify package.json").selectedAgentIds).toEqual(["argus"]);
    expect(planRoute("write README.md").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(planRoute("update the README").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(planRoute("modify README").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(planRoute("create docs/plan.md").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(planRoute("change README.md").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(planRoute("write src/app.ts").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(planRoute("edit Dockerfile").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(planRoute("patch scripts/build").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(planRoute("edit .gitignore").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(planRoute("patch .gitignore").selectedAgentIds).toEqual(["quill", "argus"]);
    expect(planRoute("run npm test").selectedAgentIds).toEqual(["argus"]);
    expect(planRoute("please run tests").selectedAgentIds).toEqual(["argus"]);
    expect(planRoute("run ls").selectedAgentIds).toEqual(["argus"]);
    expect(planRoute("execute pwd").selectedAgentIds).toEqual(["argus"]);
    expect(planRoute("run make").selectedAgentIds).toEqual(["argus"]);
    expect(planRoute("please use shell to list files").selectedAgentIds).toEqual(["argus"]);
    expect(planRoute("call an external command").selectedAgentIds).toEqual(["argus"]);
    expect(planRoute("external shell command").selectedAgentIds).toEqual(["argus"]);
    expect(planRoute("git status").selectedAgentIds).toEqual(["argus"]);
    expect(planRoute("please use git status").selectedAgentIds).toEqual(["argus"]);
    expect(planRoute("call curl -I example.com").selectedAgentIds).toEqual(["argus"]);
    expect(planRoute("execute shell command").selectedAgentIds).toEqual(["argus"]);
  });

  it("selects Argus for code-change intents", () => {
    expect(planRoute("Brainstorm workshop ideas").selectedAgentIds).toEqual([]);
    expect(planRoute("compare React and Vue").selectedAgentIds).toEqual([]);
    expect(planRoute("give me context on this topic").selectedAgentIds).toEqual([]);
    expect(planRoute("historical context of this library").selectedAgentIds).toEqual([]);
    expect(planRoute("risk management overview").selectedAgentIds).toEqual([]);
    expect(planRoute("permission systems overview").selectedAgentIds).toEqual([]);
    expect(planRoute("code review patterns").selectedAgentIds).toEqual([]);
    expect(planRoute("review code review patterns").selectedAgentIds).toEqual([]);
    expect(planRoute("review permission systems").selectedAgentIds).toEqual([]);
    expect(planRoute("Brainstorm risk workshop ideas").selectedAgentIds).toEqual([]);
    expect(planRoute("compare risk management frameworks").selectedAgentIds).toEqual([]);
    expect(planRoute("fix this bug in code").selectedAgentIds).toEqual(["orion", "argus"]);
    expect(planRoute("change code").selectedAgentIds).toEqual(["orion", "argus"]);
    expect(planRoute("patch this code").selectedAgentIds).toEqual(["orion", "quill", "argus"]);
    expect(planRoute("코드 수정해줘").selectedAgentIds).toEqual(["orion", "argus"]);
    expect(planRoute("review the final answer").selectedAgentIds).toEqual(["argus"]);
  });
});
