import { useState } from "react";
import type { FormEvent } from "react";

type TaskInputProps = {
  onSubmit: (prompt: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  isRunning?: boolean;
};

export function TaskInput({ onSubmit, onStop, disabled = false, isRunning = false }: TaskInputProps) {
  const [prompt, setPrompt] = useState("Plan my interview prep for this week");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = prompt.trim();

    if (trimmed.length > 0) {
      onSubmit(trimmed);
    }
  }

  return (
    <form className="task-input" onSubmit={handleSubmit}>
      <input
        aria-label="Task request"
        disabled={disabled}
        onChange={(event) => setPrompt(event.target.value)}
        value={prompt}
      />
      <div className="task-input-actions">
        <button disabled={disabled} type="submit">
          Send to Queue
        </button>
        {isRunning ? (
          <button className="task-stop-button" onClick={onStop} type="button">
            Stop run
          </button>
        ) : null}
      </div>
    </form>
  );
}
