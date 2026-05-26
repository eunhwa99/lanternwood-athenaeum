type FinalOutputPanelProps = {
  output: string | null;
};

export function FinalOutputPanel({ output }: FinalOutputPanelProps) {
  return (
    <section aria-label="Final output" aria-atomic="true" aria-live="polite" className="final-output-panel">
      <h2>Final Output</h2>
      <p className="final-output-text">{output ?? "Awaiting Luma's synthesis."}</p>
    </section>
  );
}
