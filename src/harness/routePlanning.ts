 import type { AgentDefinition } from "../agents/types";
 import type { RoutePlannedPayload, SpecialistAgentId } from "../events/types";

 function specialistAgents(agents: AgentDefinition[]) {
   return agents.filter((agent) => agent.id !== "luma");
 }

 function uniqueAgentIds(agentIds: SpecialistAgentId[], agents: AgentDefinition[]) {
   const specialistIds = new Set(specialistAgents(agents).map((agent) => agent.id));

   return Array.from(new Set(agentIds)).filter((agentId): agentId is SpecialistAgentId => specialistIds.has(agentId));
 }

 function tokenSequence(value: string) {
   const tokens = value.toLocaleLowerCase().match(/[\p{Letter}\p{Number}]+/gu);

   return tokens ? [...tokens] : [];
 }

 function includesOrderedTokens(inputTokens: string[], keywordTokens: string[], maxGap: number) {
   let cursor = 0;
   let previousIndex = -1;

   for (const keywordToken of keywordTokens) {
     const foundIndex = inputTokens.findIndex((inputToken, index) => index >= cursor && inputToken === keywordToken);

     if (foundIndex < 0) {
       return false;
     }

     if (previousIndex >= 0 && foundIndex - previousIndex > maxGap) {
       return false;
     }

     previousIndex = foundIndex;
     cursor = foundIndex + 1;
   }

   return true;
 }

 function keywordMatches(input: string, keyword: string) {
   const normalizedKeyword = keyword.trim().toLocaleLowerCase();
   const normalizedInput = input.toLocaleLowerCase();

   if (!normalizedKeyword) {
     return false;
   }

   if (normalizedInput.includes(normalizedKeyword)) {
     return true;
   }

   if (/[./]/.test(normalizedKeyword)) {
     return false;
   }

   const keywordTokens = tokenSequence(normalizedKeyword);
   const maxGap = keywordTokens.includes("file") ? 3 : 4;

   return keywordTokens.length > 0 && includesOrderedTokens(tokenSequence(input), keywordTokens, maxGap);
 }

 function agentMatches(input: string, agent: AgentDefinition) {
   return [
     ...agent.routing.keywords,
     agent.routing.reason,
     agent.promptInstruction,
   ].some((keyword) => keywordMatches(input, keyword));
 }

 function primaryMemoryAgent(agents: AgentDefinition[]) {
   return specialistAgents(agents).find((agent) => agent.systemRole === "MemoryAgent");
 }

 function primaryDocumentAgent(agents: AgentDefinition[]) {
   return specialistAgents(agents).find((agent) => agent.systemRole === "DocumentAgent");
 }

 function primaryReviewAgent(agents: AgentDefinition[]) {
   return specialistAgents(agents).find((agent) => agent.systemRole === "ReviewAgent");
 }

 function fallbackAgents(input: string, selectedAgentIds: SpecialistAgentId[], agents: AgentDefinition[]): SpecialistAgentId[] {
   const trimmedInput = input.trim();
   const memoryAgent = primaryMemoryAgent(agents);
   const documentAgent = primaryDocumentAgent(agents);
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
     return memoryAgent && selectedAgentIds.includes(memoryAgent.id) ? [memoryAgent.id] : [];
   }

   if (selectedAgentIds.length > 0) {
     return selectedAgentIds;
   }

   return isTextEditRequest && documentAgent ? [documentAgent.id] : [];
 }

 function isLowRiskRoute(selectedAgentIds: SpecialistAgentId[], agents: AgentDefinition[]) {
   const selectedAgents = specialistAgents(agents).filter((agent) => selectedAgentIds.includes(agent.id));

   return (
     selectedAgents.length > 0 &&
     selectedAgents.every((agent) => agent.systemRole === "DocumentAgent" || agent.systemRole === "ResearchAgent") &&
     selectedAgents.some((agent) => agent.systemRole === "DocumentAgent")
   );
 }

 function confidenceFor(input: string, selectedAgentIds: SpecialistAgentId[], agents: AgentDefinition[]) {
   if (selectedAgentIds.length === 0) {
     return "high";
   }

   if (selectedAgentIds.length >= 3 || (input.trim().length > 220 && !isLowRiskRoute(selectedAgentIds, agents))) {
     return "low";
   }

   if (input.trim().length > 220) {
     return "medium";
   }

   return selectedAgentIds.length === 1 ? "medium" : "high";
 }

 function shouldAddReviewFallback(selectedAgentIds: SpecialistAgentId[], agents: AgentDefinition[]) {
   const reviewAgent = primaryReviewAgent(agents);

   if (!reviewAgent || selectedAgentIds.length === 0 || selectedAgentIds.includes(reviewAgent.id)) {
     return false;
   }

   return !isLowRiskRoute(selectedAgentIds, agents);
 }

 export function planRoute(input: string, agents: AgentDefinition[]): RoutePlannedPayload {
   const specialists = specialistAgents(agents);
   const matchedAgents = specialists.filter((agent) => agentMatches(input, agent));
   const selectedAgentIds = uniqueAgentIds(
     fallbackAgents(
       input,
       matchedAgents.map((agent) => agent.id),
       agents,
     ),
     agents,
   );
   const confidence = confidenceFor(input, selectedAgentIds, agents);
   const reviewAgent = primaryReviewAgent(agents);
   const selectedWithFallback =
     confidence === "low" && shouldAddReviewFallback(selectedAgentIds, agents) && reviewAgent
       ? uniqueAgentIds([...selectedAgentIds, reviewAgent.id], agents)
       : selectedAgentIds;
   const skippedAgentIds = specialists.map((agent) => agent.id).filter((agentId) => !selectedWithFallback.includes(agentId));
   const selectedReasons = specialists
     .filter((agent) => selectedWithFallback.includes(agent.id))
     .map((agent) => agent.routing.reason);
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
