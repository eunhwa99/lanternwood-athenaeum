import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

describe("verification scripts", () => {
  it("defines one full verification command that includes e2e", () => {
    expect(packageJson.scripts.verify).toBe(
      "npm run typecheck && npm test && npm run lint && npm run build && npm run e2e",
    );
  });

  it("keeps the default e2e command as the Playwright test set", () => {
    expect(packageJson.scripts.e2e).toBe("playwright test");
  });
});
