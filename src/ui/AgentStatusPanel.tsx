import type { RunState } from "../events/types";

type AgentStatusPanelProps = {
  state: RunState;
};

export function AgentStatusPanel({ state }: AgentStatusPanelProps) {
  return (
    <section className="panel-section" aria-label="Agent status">
      <h2>Agents</h2>
      <div className="agent-list">
        {Object.values(state.agents).map((agent) => (
          <article className="agent-card" key={agent.definition.id}>
            <span
              className="agent-dot"
              style={{ background: agent.definition.color }}
            />
            <div>
              <h3>{agent.definition.displayName}</h3>
              <p>{agent.definition.worldRole}</p>
              <strong>{agent.status}</strong>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
