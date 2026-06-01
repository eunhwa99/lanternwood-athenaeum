import { describe, expect, it } from "vitest";
import packageJson from "../package.json";

describe("verification scripts", () => {
  it("defines one full verification command that includes e2e", () => {
    expect(packageJson.scripts.verify).toContain("npm run typecheck");
    expect(packageJson.scripts.verify).toContain("npm test");
    expect(packageJson.scripts.verify).toContain("npm run lint");
    expect(packageJson.scripts.verify).toContain("npm run build");
    expect(packageJson.scripts.verify).toContain("npm run e2e");
  });

  it("keeps the default e2e command as the Playwright test set", () => {
    expect(packageJson.scripts.e2e).toBe("playwright test");
  });
});
