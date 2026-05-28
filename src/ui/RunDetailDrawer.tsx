 import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
 import { AGENTS } from "../agents/registry";
 import type { AgentId } from "../agents/types";
 import { taskLabelFor } from "../events/taskLabels";
 import type { AgentJob, RunState, TaskRecord } from "../events/types";
 import { createRunDetails, previewText, type RunDetailsTab } from "./runDetails";

 type RunDetailDrawerProps = {
   initialTab?: RunDetailsTab;
   isOpen: boolean;
   onClose: () => void;
   runMode?: "codex" | "mock";
   selectedAgentId?: AgentId;
   selectedTaskId?: string;
   state: RunState;
 };

 const tabs: Array<{ id: RunDetailsTab; label: string }> = [
   { id: "routing", label: "Routing" },
   { id: "reports", label: "Agent reports" },
   { id: "prompts", label: "Coordinator prompts" },
   { id: "workload", label: "Workload" },
   { id: "log", label: "Run log" },
 ];

 type WorkloadView = "task" | "agent" | "all";

 function focusableElements(container: HTMLElement) {
   return Array.from(
     container.querySelectorAll<HTMLElement>(
       'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
     ),
   ).filter((element) => !element.hasAttribute("disabled") && !element.getAttribute("aria-hidden"));
 }

 function reportKey(report: { eventId: string }) {
   return report.eventId;
 }

 function agentDisplayName(agentId: AgentId) {
   return AGENTS.find((agent) => agent.id === agentId)?.displayName ?? agentId;
 }

 function jobStatusLabel(state: RunState, job: AgentJob) {
   return job.status === "running" ? state.agents[job.agentId].status : job.status;
 }

 function taskJobs(state: RunState, taskId: string) {
   return AGENTS.flatMap((agent) =>
     state.agentQueues[agent.id]
       .filter((job) => job.taskId === taskId)
       .map((job) => ({
         agent,
         job,
       })),
   );
 }

 function taskStatusClass(task: TaskRecord) {
   return `workload-status workload-status-${task.status}`;
 }

 function WorkloadTaskView({ selectedTaskId, state }: { selectedTaskId?: string; state: RunState }) {
   const task =
     (selectedTaskId ? state.tasks.find((candidate) => candidate.taskId === selectedTaskId) : undefined) ??
     (state.currentTask ? state.tasks.find((candidate) => candidate.taskId === state.currentTask?.taskId) : undefined) ??
     state.tasks.find((candidate) => candidate.status !== "done" && candidate.status !== "failed") ??
     state.tasks.at(-1);

   if (!task) {
     return (
       <section aria-label="Current task workload" className="workload-empty">
         <p>No task workload yet.</p>
       </section>
     );
   }

   const jobs = taskJobs(state, task.taskId);

   return (
     <section aria-label="Current task workload" className="workload-panel">
       <header className="workload-panel-header">
         <h3>
           <span className="task-badge task-badge-small">{taskLabelFor(state.tasks, task.taskId)}</span>
           <span>{task.prompt}</span>
         </h3>
         <span className={taskStatusClass(task)}>{task.status}</span>
       </header>
       {jobs.length > 0 ? (
         <ol className="workload-list">
           {jobs.map(({ agent, job }) => (
             <li className="workload-list-item" key={job.jobId}>
               <div>
                 <strong>{agent.displayName}</strong>
                 <p>{previewText(job.prompt, 140)}</p>
               </div>
               <span className="workload-status">{jobStatusLabel(state, job)}</span>
             </li>
           ))}
         </ol>
       ) : (
         <p className="workload-empty">Luma is handling this directly.</p>
       )}
     </section>
   );
 }

 function WorkloadAgentView({ selectedAgentId, state }: { selectedAgentId?: AgentId; state: RunState }) {
   const agents = selectedAgentId ? AGENTS.filter((agent) => agent.id === selectedAgentId) : AGENTS;

   return (
     <section aria-label="Agent workload" className="workload-panel">
       <div className="workload-agent-grid">
         {agents.map((agent) => {
           const jobs = state.agentQueues[agent.id];
           const currentJob = state.agents[agent.id].currentJobId
             ? jobs.find((job) => job.jobId === state.agents[agent.id].currentJobId)
             : jobs.find((job) => job.status === "running");
           const queuedJobs = jobs.filter((job) => job.status === "queued");

           return (
             <article aria-label={`${agent.displayName} workload`} className="workload-agent-card" key={agent.id}>
               <header className="workload-agent-header">
                 <h3>{agent.displayName}</h3>
                 <span className="workload-status">{state.agents[agent.id].status}</span>
               </header>
               {currentJob ? (
                 <div className="workload-agent-block">
                   <h4>Now</h4>
                   <p>
                     <span className="task-badge task-badge-small">{taskLabelFor(state.tasks, currentJob.taskId)}</span>
                     <span>{previewText(currentJob.prompt, 120)}</span>
                   </p>
                 </div>
               ) : (
                 <p className="workload-empty">No active job.</p>
               )}
               <div className="workload-agent-block">
                 <h4>Queue</h4>
                 {queuedJobs.length > 0 ? (
                   <ol className="workload-mini-list">
                     {queuedJobs.map((job) => (
                       <li key={job.jobId}>
                         <span className="task-badge task-badge-small">{taskLabelFor(state.tasks, job.taskId)}</span>
                         <span>{previewText(job.prompt, 110)}</span>
                       </li>
                     ))}
                   </ol>
                 ) : (
                   <p className="workload-empty">No queued work.</p>
                 )}
               </div>
             </article>
           );
         })}
       </div>
     </section>
   );
 }

 function WorkloadAllTasksView({ state }: { state: RunState }) {
   return (
     <section aria-label="All task workload" className="workload-panel">
       {state.tasks.length > 0 ? (
         <ol className="workload-list">
           {state.tasks.map((task) => (
             <li className="workload-list-item" key={task.taskId}>
               <div>
                 <strong>
                   <span className="task-badge task-badge-small">{taskLabelFor(state.tasks, task.taskId)}</span>
                   <span>{task.prompt}</span>
                 </strong>
                 <p>
                   {task.selectedAgentIds.length > 0
                     ? task.selectedAgentIds.map(agentDisplayName).join(", ")
                     : "Luma direct"}
                 </p>
               </div>
               <span className={taskStatusClass(task)}>{task.status}</span>
             </li>
           ))}
         </ol>
       ) : (
         <p className="workload-empty">No tasks yet.</p>
       )}
     </section>
   );
 }

 export function RunDetailDrawer({ initialTab = "reports", isOpen, onClose, selectedAgentId, selectedTaskId, state }: RunDetailDrawerProps) {
   const [activeTab, setActiveTab] = useState<RunDetailsTab>(initialTab);
   const [selectedReport, setSelectedReport] = useState<{ key: string; scope: string } | null>(null);
   const [workloadView, setWorkloadView] = useState<WorkloadView>(() => (selectedAgentId ? "agent" : "task"));
   const drawerRef = useRef<HTMLElement | null>(null);
   const previousFocusRef = useRef<HTMLElement | null>(null);
   const details = useMemo(() => createRunDetails(state, selectedTaskId), [selectedTaskId, state]);
   const selectedAgent = selectedAgentId ? AGENTS.find((agent) => agent.id === selectedAgentId) : undefined;
   const selectedTask = selectedTaskId ? state.tasks.find((task) => task.taskId === selectedTaskId) : undefined;
   const visibleReports = selectedAgentId
     ? details.agentReports.filter((report) => report.agentId === selectedAgentId)
     : details.agentReports;
   const visiblePrompts = selectedAgentId
     ? details.prompts.filter((prompt) => prompt.recipientAgentId === selectedAgentId || prompt.senderAgentId === selectedAgentId)
     : details.prompts;
   const reportList = visibleReports.slice().reverse();
   const reportScope = `${selectedAgentId ?? "all"}:${selectedTaskId ?? "all"}:${state.timeline.length}`;
   const selectedReportDetail =
     selectedReport?.scope === reportScope
       ? reportList.find((report) => reportKey(report) === selectedReport.key) ?? reportList[0]
       : reportList[0];

   useEffect(() => {
     if (!isOpen) {
       return;
     }

     previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
     const appRoot = document.querySelector<HTMLElement>(".library-stage");
     appRoot?.setAttribute("inert", "");
     window.setTimeout(() => focusableElements(drawerRef.current ?? document.body)[0]?.focus(), 0);

     return () => {
       appRoot?.removeAttribute("inert");
       previousFocusRef.current?.focus();
     };
   }, [isOpen]);

   if (!isOpen) {
     return null;
   }

   function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
     if (event.key === "Escape") {
       event.preventDefault();
       onClose();
       return;
     }

     if (event.key !== "Tab" || !drawerRef.current) {
       return;
     }

     const focusables = focusableElements(drawerRef.current);
     const first = focusables[0];
     const last = focusables.at(-1);

     if (!first || !last) {
       return;
     }

     if (event.shiftKey && document.activeElement === first) {
       event.preventDefault();
       last.focus();
     } else if (!event.shiftKey && document.activeElement === last) {
       event.preventDefault();
       first.focus();
     }
   }

   function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, tabIndex: number) {
     if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
       return;
     }

     event.preventDefault();
     const offset = event.key === "ArrowRight" ? 1 : -1;
     const nextIndex = (tabIndex + offset + tabs.length) % tabs.length;
     const nextTab = tabs[nextIndex];
     setActiveTab(nextTab.id);
     document.getElementById(`run-detail-tab-${nextTab.id}`)?.focus();
   }

   return (
     <div className="drawer-backdrop">
       <section
         aria-label="Run details"
         aria-modal="true"
         className="run-detail-drawer"
         onKeyDown={handleDialogKeyDown}
         ref={drawerRef}
         role="dialog"
       >
         <header className="drawer-header">
           <h2>{selectedAgent ? `${selectedAgent.displayName} Details` : selectedTask ? `Task Details ${details.selectedTaskLabel}` : "Run Details"}</h2>
           <button onClick={onClose} type="button">
             Close
           </button>
         </header>

         <div aria-label="Run detail tabs" className="drawer-tabs" role="tablist">
           {tabs.map((tab, tabIndex) => (
             <button
               aria-controls={`run-detail-panel-${tab.id}`}
               aria-selected={activeTab === tab.id}
               id={`run-detail-tab-${tab.id}`}
               key={tab.id}
               onKeyDown={(event) => handleTabKeyDown(event, tabIndex)}
               onClick={() => setActiveTab(tab.id)}
               role="tab"
               tabIndex={activeTab === tab.id ? 0 : -1}
               type="button"
             >
               {tab.label}
             </button>
           ))}
         </div>

         <div className="drawer-content">
           {activeTab === "routing" ? (
             <section
               aria-labelledby="run-detail-tab-routing"
               id="run-detail-panel-routing"
               role="tabpanel"
               tabIndex={0}
             >
               <h3>Routing Decision</h3>
               {details.routing.length > 0 ? (
                 <div className="drawer-list-panel">
                   {details.routing.map((route, index) => (
                     <article className="drawer-list-item routing-detail" key={`${index}-${route.rationale}`}>
                       <h4>
                         <span className="task-badge task-badge-small">{route.taskLabel}</span>
                         <span>Confidence: {route.confidence}</span>
                       </h4>
                       <p>
                         Selected agents: {route.selectedNames.join(", ") || "None"}
                         {"\n"}
                         Skipped agents: {route.skippedNames.join(", ") || "None"}
                         {"\n"}
                         Reason: {route.rationale}
                       </p>
                     </article>
                   ))}
                 </div>
               ) : (
                 <p>No routing decision captured for this run.</p>
               )}
             </section>
           ) : null}

           {activeTab === "reports" ? (
             <section
               aria-labelledby="run-detail-tab-reports"
               id="run-detail-panel-reports"
               role="tabpanel"
               tabIndex={0}
             >
               <h3>Agent reports</h3>
               {visibleReports.length > 0 ? (
                 <div className="report-reader-layout">
                   <ul aria-label="Agent report list" className="report-list">
                     {reportList.map((report) => {
                       const isSelected = selectedReportDetail ? reportKey(report) === reportKey(selectedReportDetail) : false;

                       return (
                         <li key={reportKey(report)}>
                           <button
                             aria-label={`Select ${report.taskLabel} ${report.displayName} report`}
                             aria-pressed={isSelected}
                             className="report-list-button"
                             onClick={() => setSelectedReport({ key: reportKey(report), scope: reportScope })}
                             type="button"
                           >
                             <span className="report-list-title">
                               <span className="task-badge task-badge-small">{report.taskLabel}</span>
                               <span>{report.displayName}</span>
                             </span>
                             <span className="report-list-preview">{report.report}</span>
                           </button>
                         </li>
                       );
                     })}
                   </ul>
                   {selectedReportDetail ? (
                     <article aria-label="Selected agent report" className="report-reader">
                       <header className="report-reader-header">
                         <h4>
                           <span className="task-badge task-badge-small">{selectedReportDetail.taskLabel}</span>
                           <span>{selectedReportDetail.displayName}</span>
                         </h4>
                         <p>{selectedReportDetail.taskPrompt}</p>
                       </header>
                       <pre>{selectedReportDetail.report}</pre>
                     </article>
                   ) : null}
                 </div>
               ) : (
                 <p>No agent reports captured for this run.</p>
               )}
             </section>
           ) : null}

           {activeTab === "prompts" ? (
             <section
               aria-labelledby="run-detail-tab-prompts"
               id="run-detail-panel-prompts"
               role="tabpanel"
               tabIndex={0}
             >
               <h3>Coordinator prompts</h3>
               {visiblePrompts.length > 0 ? (
                 <div className="drawer-list-panel">
                   {visiblePrompts.map((prompt) => (
                     <article className="drawer-list-item" key={`${prompt.taskId}-${prompt.senderAgentId}-${prompt.recipientAgentId}-${prompt.prompt}`}>
                       <h4>
                         <span className="task-badge task-badge-small">{prompt.taskLabel}</span>
                         <span>
                           {prompt.senderName} to {prompt.recipientName}
                         </span>
                       </h4>
                       <p>{prompt.prompt}</p>
                     </article>
                   ))}
                 </div>
               ) : (
                 <p>No prompts captured for this run.</p>
               )}
             </section>
           ) : null}

           {activeTab === "workload" ? (
             <section
               aria-labelledby="run-detail-tab-workload"
               id="run-detail-panel-workload"
               role="tabpanel"
               tabIndex={0}
             >
               <header className="drawer-section-header">
                 <h3>Workload</h3>
               </header>
               <div aria-label="Workload view" className="workload-view-toggle">
                 {[
                   ["task", "Current task"],
                   ["agent", "By agent"],
                   ["all", "All tasks"],
                 ].map(([view, label]) => (
                   <button
                     aria-pressed={workloadView === view}
                     key={view}
                     onClick={() => setWorkloadView(view as WorkloadView)}
                     type="button"
                   >
                     {label}
                   </button>
                 ))}
               </div>
               {workloadView === "task" ? <WorkloadTaskView selectedTaskId={selectedTaskId} state={state} /> : null}
               {workloadView === "agent" ? <WorkloadAgentView selectedAgentId={selectedAgentId} state={state} /> : null}
               {workloadView === "all" ? <WorkloadAllTasksView state={state} /> : null}
             </section>
           ) : null}

           {activeTab === "log" ? (
             <section
               aria-labelledby="run-detail-tab-log"
               id="run-detail-panel-log"
               role="tabpanel"
               tabIndex={0}
             >
               <h3>Run log</h3>
               {details.runLog.length > 0 ? (
                 <ol className="drawer-run-log">
                   {details.runLog.map((item, index) => (
                     <li key={`${index}-${item}`}>{item}</li>
                   ))}
                 </ol>
               ) : (
                 <p>No run log entries captured yet.</p>
               )}
             </section>
           ) : null}
         </div>
       </section>
     </div>
   );
 }
