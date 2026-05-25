import { useState } from "react";
import type { FormEvent } from "react";

type TaskInputProps = {
  onSubmit: (prompt: string) => void;
  disabled?: boolean;
};

export function TaskInput({ onSubmit, disabled = false }: TaskInputProps) {
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
      <button disabled={disabled} type="submit">
        Send to Luma
      </button>
    </form>
  );
}
