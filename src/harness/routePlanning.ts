import type { RoutePlannedPayload, SpecialistAgentId } from "../events/types";

const SPECIALIST_IDS: SpecialistAgentId[] = ["orion", "neria", "quill", "argus"];

const ROUTING_RULES: Array<{
  agentId: SpecialistAgentId;
  keywords: RegExp;
  reason: string;
}> = [
  {
    agentId: "orion",
    keywords:
      /(?:\b(research|latest|current|facts?|verify|source|sources|uncertain|uncertainty|repo|explore)\b|\b(?:technical|risk|code|source|repo|fact|factual)\s+analysis\b|\b(?:inspect|analy[sz]e|explore|read|check|verify|fix|change|modify|update|edit|patch).*(?:code|repo|source|docs?|documents?)\b|\banaly[sz]e\s+(?:the\s+)?(?:code|repo|source|docs?|documents?)\b|\b(?:explore|read|check|verify)\s+(?:the\s+)?(?:document|documents|docs?)\b|\b(?:document|documents|docs?)\s+(?:exploration|research|analysis)\b|최신|현재|사실\s*확인|검증|출처|불확실|코드\s*(?:탐색|검토|분석|변경|수정)|문서\s*탐색|탐색|기술\s*분석)/i,
    reason: "current technical analysis, code/document exploration, fact-checking, or uncertainty handling",
  },
  {
    agentId: "neria",
    keywords:
      /(?:\b(?:my|personal|global|long-?term|conversation)\s+(?:memory|memories|preference|preferences|persona|personas|context|history)\b|\buser\s+(?:memory|memories|preference|preferences|context|history)\b|\bobsidian\b.*\b(?:memory|context|persona|preference|preferences)\b|\b(?:memory|context|persona|preference|preferences)\b.*\bobsidian\b|\b(?:remember|memory|context|history)\s+from\s+(?:the\s+)?(?:previous|prior|earlier|last)\b|\b(?:previous|prior|earlier|last)\s+(?:run|request|question|conversation|answer|delegation|agent|agents|context|history|follow-?up)\b|\b(?:conversation|user|personal|long-?term)\s+(?:context|history)\b|\b(?:context|history)\s+from\s+(?:the\s+)?(?:previous|prior|earlier|last)\b|방금|(?:이전|지난).*(?:질문|요청|실행|런|대화|답변|위임|agent|에이전트|맥락)|기억.*(?:이전|사용자|선호|옵시디언)|사용자\s*(?:맥락|선호|페르소나)|옵시디언.*(?:기억|맥락|페르소나|선호)|(?:기억|맥락|페르소나|선호).*옵시디언)/i,
    reason: "previous-run context, user preferences, Obsidian/global persona, or long-term memory context",
  },
  {
    agentId: "quill",
    keywords:
      /(?:\b(write|writing|rewrite|improve|edit|editing|patch|revise|revision|proofread|clean\s+up|polish|wording|sentence|paragraph|draft|plan|plans|readme|doc|docs|document|documents|prompt|prompts|structure|copy|summary|summarize|outline)\b|\breview\b.*\b(?:paragraph|sentence|wording|readme|docs?|documents?|prose|quality)\b|\b(?:paragraph|sentence|wording|readme|docs?|documents?|prose|quality)\b.*\breview\b|문서|문단|문장|글|계획|작성|정리|초안|요약|구조화|써줘|명확하게|(?:글|문단|문장|문서|README).*(?:검토)|(?:검토).*(?:글|문단|문장|문서|README))/i,
    reason: "structured writing, planning, prompts, README/docs, or reusable output shaping",
  },
  {
    agentId: "argus",
    keywords:
      /(?:\b(?:risky|delete|remove|overwrite)\b|\b(?:risk|risks|permission|permissions)\s+(?:review|check|assessment)\b|\b(?:review|check)\b.*(?:bug|risky|scope|final\s+(?:answer|response|output)|completion\s+criteria)|\breview\s+(?:this|the)\s+code\b|\bfiles?[-\s]+(?:write|change|edit|create|delete|patch)\b|\b(?:write|change|edit|create|delete|patch)\s+(?:to\s+|into\s+)?(?:(?:a|an|the|this|that)\s+)?(?:new\s+)?files?\b|\b(?:write|create|delete|remove|change|edit|patch|modify|update)\s+(?:(?:a|an|the)\s+)?(?:(?:[\w.-]+\/)+[\w.-]+|(?:Dockerfile|Makefile|Procfile)|\.[\w.-]+|[\w.-]+\.(?:[a-z0-9]{1,8}))\b|\b(?:change|edit|patch|modify|update)\s+(?:the\s+)?readme\b|\b(?:run|execute|call|invoke)\s+(?:(?:a|the|this|an)\s+)?(?:external\s+)?(?:command|commands|shell|script|tests?|test\s+suite|e2e|lint|build|typecheck|npm|git|pnpm|yarn|node|python|bash|sh|make|ls|pwd|curl|\.\/|[a-z0-9_.:-]+)(?:\b|$)|\b(?:use|call|invoke)\s+(?:a\s+|an\s+|the\s+)?(?:external\s+)?(?:shell|command|script|git|curl|npm|pnpm|yarn)\b|\bexternal\s+(?:shell|command)\s+command\b|\b(?:external\s+)?(?:command|commands|shell)\s+(?:execution|to\s+run|should\s+i\s+run)\b|\b(?:git|npm|pnpm|yarn|node|python|bash|sh|curl)\s+[a-z0-9_.:-]+\b|\bcode\s*changes?\b|(?:fix|change|modify|update|edit|patch).*(?:code|bug)|(?:code|bug).*(?:fix|change|modify|update|edit|patch)|\bfinal\s+(?:answer|response|output)\b|\blong\s+(?:final\s+)?(?:answer|response|output)\b|\bcreate\s+(an?\s+)?(?:obsidian\s+)?note\b|\bcreate\s+(a\s+)?project\b|\bnew\s+(?:note|project)\b|리스크\s*(?:검토|확인)|위험\s*(?:검토|확인)|권한\s*(?:확인|검토)|삭제|파일\s*(?:쓰기|수정|삭제|생성)|명령\s*(?:실행|수행)|실행할\s*명령|코드\s*(?:변경|수정|검토)|버그.*(?:수정|고쳐|검토)|(?:수정|고쳐|검토).*버그|최종\s*(?:답변|응답|출력)|(?:최종|완료|위험|리스크).*(?:누락)|(?:노트|프로젝트|파일).*(?:만들|생성)|(?:만들|생성).*(?:노트|프로젝트|파일))/i,
    reason: "risk review, permissions, file changes, command execution, or completion-quality checks",
  },
];

function uniqueAgentIds(agentIds: SpecialistAgentId[]) {
  return Array.from(new Set(agentIds)).filter((agentId): agentId is SpecialistAgentId => SPECIALIST_IDS.includes(agentId));
}

function fallbackAgents(input: string, selectedAgentIds: SpecialistAgentId[]): SpecialistAgentId[] {
  const trimmedInput = input.trim();
  const isSimpleQuestion =
    trimmedInput.length <= 160 &&
    (/^(?:(?:can|could|would)\s+you\s+|please\s+)?(?:briefly\s+|quickly\s+|simply\s+)?(?:what|who|when|where|why|how|explain|show|tell|상태|뭐|왜|어떻게|누구)/i.test(
      trimmedInput,
    ) ||
      /^(?:(?:should|do|does|is|are)\b|which\b)/i.test(trimmedInput) ||
      /^(?:(?:can|could|would)\s+you\s+|please\s+)?give\s+me\s+(?:a\s+)?(?:brief|short|quick|simple)?\s*explanation\b/i.test(
        trimmedInput,
      ));
  const isTextEditRequest =
    /\b(make|revise|rewrite|improve|polish|clean\s+up|proofread|wording|sentence|paragraph|profile|concise|stronger|clearer)\b/i.test(
      input,
    );

  if (isSimpleQuestion) {
    return selectedAgentIds.includes("neria") ? ["neria"] : [];
  }

  if (/(?:^|\s)please\s+run\s+(?:tests?|test\s+suite|e2e|lint|build|typecheck)\b/i.test(trimmedInput)) {
    return uniqueAgentIds([...selectedAgentIds, "argus"]);
  }

  if (/\b(?:run|execute|call|invoke)\s+(?:ls|pwd|make|curl|git|npm|pnpm|yarn|node|python|bash|sh)(?:\b|$)/i.test(trimmedInput)) {
    return uniqueAgentIds([...selectedAgentIds, "argus"]);
  }

  if (/\b(?:use|call|invoke)\s+(?:a\s+|an\s+|the\s+)?(?:external\s+)?(?:shell|command|script|git|curl|npm|pnpm|yarn)\b/i.test(trimmedInput)) {
    return uniqueAgentIds([...selectedAgentIds, "argus"]);
  }

  if (/^(?:git|npm|pnpm|yarn|node|python|bash|sh|curl)\s+\S+/i.test(trimmedInput)) {
    return uniqueAgentIds([...selectedAgentIds, "argus"]);
  }

  if (selectedAgentIds.length > 0) {
    return selectedAgentIds;
  }

  return isTextEditRequest ? ["quill"] : [];
}

function isLowRiskWritingRoute(selectedAgentIds: SpecialistAgentId[]) {
  const routeSet = new Set(selectedAgentIds);
  return routeSet.has("quill") && selectedAgentIds.every((agentId) => agentId === "quill" || agentId === "orion");
}

function confidenceFor(input: string, selectedAgentIds: SpecialistAgentId[]) {
  if (selectedAgentIds.length === 0) {
    return "high";
  }

  if (selectedAgentIds.length >= 3 || (input.trim().length > 220 && !isLowRiskWritingRoute(selectedAgentIds))) {
    return "low";
  }

  if (input.trim().length > 220) {
    return "medium";
  }

  return selectedAgentIds.length === 1 ? "medium" : "high";
}

function shouldAddArgusFallback(selectedAgentIds: SpecialistAgentId[]) {
  if (selectedAgentIds.length === 0 || selectedAgentIds.includes("argus")) {
    return false;
  }

  return !isLowRiskWritingRoute(selectedAgentIds);
}

export function planRoute(input: string): RoutePlannedPayload {
  const matchedRules = ROUTING_RULES.filter((rule) => rule.keywords.test(input));
  const selectedAgentIds = uniqueAgentIds(fallbackAgents(input, matchedRules.map((rule) => rule.agentId)));
  const confidence = confidenceFor(input, selectedAgentIds);
  const selectedWithFallback =
    confidence === "low" && shouldAddArgusFallback(selectedAgentIds)
      ? uniqueAgentIds([...selectedAgentIds, "argus"])
      : selectedAgentIds;
  const skippedAgentIds = SPECIALIST_IDS.filter((agentId) => !selectedWithFallback.includes(agentId));
  const selectedReasons = ROUTING_RULES.filter((rule) => selectedWithFallback.includes(rule.agentId)).map((rule) => rule.reason);
  const rationale =
    selectedWithFallback.length === 0
      ? "The request is low-risk and simple enough for Luma to answer directly without specialist routing."
      : `The request needs ${selectedReasons.join("; ")}.`;

  return {
    confidence,
    rationale,
    selectedAgentIds: selectedWithFallback,
    skippedAgentIds,
  };
}
