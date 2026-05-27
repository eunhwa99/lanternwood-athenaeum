import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AGENTS } from "../agents/registry";
import type { AgentId } from "../agents/types";
import type { RunState } from "../events/types";
import { createRunDetails, type RunDetailsTab } from "./runDetails";

type RunDetailDrawerProps = {
  initialTab?: RunDetailsTab;
  isOpen: boolean;
  onClose: () => void;
  runMode?: "codex" | "mock";
  selectedAgentId?: AgentId;
  state: RunState;
};

const tabs: Array<{ id: RunDetailsTab; label: string }> = [
  { id: "final", label: "Final output" },
  { id: "reports", label: "Agent reports" },
  { id: "prompts", label: "Coordinator prompts" },
  { id: "raw", label: "Raw Codex" },
  { id: "log", label: "Run log" },
];

function focusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("disabled") && !element.getAttribute("aria-hidden"));
}

export function RunDetailDrawer({ initialTab = "final", isOpen, onClose, selectedAgentId, state }: RunDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<RunDetailsTab>(initialTab);
  const [copyStatus, setCopyStatus] = useState<"copied" | "failed" | "idle">("idle");
  const drawerRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const details = useMemo(() => createRunDetails(state), [state]);
  const selectedAgent = selectedAgentId ? AGENTS.find((agent) => agent.id === selectedAgentId) : undefined;
  const visibleReports = selectedAgentId
    ? details.agentReports.filter((report) => report.agentId === selectedAgentId)
    : details.agentReports;
  const visiblePrompts = selectedAgentId
    ? details.prompts.filter((prompt) => prompt.recipientAgentId === selectedAgentId || prompt.senderAgentId === selectedAgentId)
    : details.prompts;
  const visibleRaw = selectedAgentId
    ? details.rawCodexByAgent
        .filter((report) => report.agentId === selectedAgentId)
        .map((report) => report.rawResponse)
        .filter((raw): raw is string => Boolean(raw))
        .join("\n\n")
    : details.rawCodex;

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

  async function copyFinalOutput() {
    if (!details.finalOutput) {
      return;
    }

    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        throw new Error("Clipboard unavailable");
      }

      await navigator.clipboard.writeText(details.finalOutput);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
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
          <h2>{selectedAgent ? `${selectedAgent.displayName} Details` : "Run Details"}</h2>
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
          {activeTab === "final" ? (
            <section
              aria-labelledby="run-detail-tab-final"
              id="run-detail-panel-final"
              role="tabpanel"
              tabIndex={0}
            >
              <div className="drawer-section-header">
                <h3>Final output</h3>
                <button disabled={!details.finalOutput} onClick={copyFinalOutput} type="button">
                  Copy
                </button>
              </div>
              <p aria-live="polite" className="copy-status">
                {copyStatus === "copied" ? "Copied final output." : copyStatus === "failed" ? "Copy failed." : ""}
              </p>
              <pre>{details.finalOutput ?? "Awaiting Luma's synthesis."}</pre>
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
                <div className="drawer-list-panel">
                  {visibleReports.map((report) => (
                    <article className="drawer-list-item" key={`${report.agentId}-${report.report}`}>
                      <h4>{report.displayName}</h4>
                      <p>{report.report}</p>
                    </article>
                  ))}
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
                    <article className="drawer-list-item" key={`${prompt.senderAgentId}-${prompt.recipientAgentId}-${prompt.prompt}`}>
                      <h4>
                        {prompt.senderName} to {prompt.recipientName}
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

          {activeTab === "raw" ? (
            <section
              aria-labelledby="run-detail-tab-raw"
              id="run-detail-panel-raw"
              role="tabpanel"
              tabIndex={0}
            >
              <h3>Raw Codex</h3>
              <pre>{visibleRaw || "No raw response captured for this run."}</pre>
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
