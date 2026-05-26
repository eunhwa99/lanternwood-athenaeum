import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "../test/render";
import { FinalOutputPanel } from "./FinalOutputPanel";

describe("FinalOutputPanel", () => {
  it("preserves multiline synthesized output for readable formatting", () => {
    renderApp(<FinalOutputPanel output={"Summary\n- First action\n- Second action"} />);

    const region = screen.getByRole("region", { name: "Final output" });
    const outputText = region.querySelector(".final-output-text");

    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "true");
    expect(outputText).not.toBeNull();
    expect(outputText).toHaveTextContent("Summary\n- First action\n- Second action", { normalizeWhitespace: false });
  });
});
