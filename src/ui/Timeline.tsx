import type { AgentEvent } from "../events/types";

type TimelineProps = {
  events: AgentEvent[];
};

export function Timeline({ events }: TimelineProps) {
  return (
    <section className="panel-section" aria-label="Event timeline">
      <h2>Timeline</h2>
      <ol className="timeline">
        {events.map((event) => (
          <li key={event.eventId}>
            <span className="timeline-type">{event.type}</span>
            <span>{event.message}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
