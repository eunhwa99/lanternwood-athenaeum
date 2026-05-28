type FinalOutputPanelProps = {
  onOpenFull?: () => void;
  output: string | null;
};

function previewOutput(output: string | null) {
  if (!output) {
    return "Awaiting Luma's synthesis.";
  }

  return output.length > 320 ? `${output.slice(0, 320)}...` : output;
}

export function FinalOutputPanel({ onOpenFull, output }: FinalOutputPanelProps) {
  return (
    <section aria-label="Final output" aria-atomic="true" aria-live="polite" className="final-output-panel">
      <div className="panel-title-row">
        <h2>Final Output</h2>
        <button disabled={!output} onClick={onOpenFull} type="button">
          Open full final output
        </button>
      </div>
      <p className="final-output-text">{previewOutput(output)}</p>
    </section>
  );
}
