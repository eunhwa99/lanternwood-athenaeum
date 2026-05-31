import { describe, expect, it } from "vitest";
import {
  codexRequestTokenHeader,
  dashboardCorsOrigin,
  defaultDashboardOrigins,
  parseDashboardOrigins,
  validateCodexPostRequest,
} from "./httpGuards";

describe("codex http guards", () => {
  it("accepts browser POSTs from the dashboard origin with the expected token", () => {
    expect(
      validateCodexPostRequest({
        contentType: "application/json; charset=utf-8",
        expectedToken: "dev-token",
        origin: "http://127.0.0.1:5173",
        token: "dev-token",
      }),
    ).toEqual({ ok: true });
  });

  it("accepts browser POSTs from the local e2e dashboard origin", () => {
    expect(
      validateCodexPostRequest({
        contentType: "application/json",
        expectedToken: "dev-token",
        origin: "http://127.0.0.1:5175",
        token: "dev-token",
      }),
    ).toEqual({ ok: true });
  });

  it("accepts configured local dashboard origins", () => {
    expect(
      validateCodexPostRequest({
        allowedOrigins: ["http://127.0.0.1:5199"],
        contentType: "application/json",
        origin: "http://127.0.0.1:5199",
      }),
    ).toEqual({ ok: true });
  });

  it("ignores configured dashboard origins that are not local http origins", () => {
    expect(parseDashboardOrigins("https://example.test, *, file://localhost/tmp, http://127.0.0.1:5199/path")).toEqual(
      defaultDashboardOrigins,
    );
    expect(parseDashboardOrigins("https://example.test, http://localhost:5199")).toEqual(["http://localhost:5199"]);
  });

  it("rejects cross-origin POSTs before the request can reach Codex", () => {
    expect(
      validateCodexPostRequest({
        contentType: "application/json",
        expectedToken: "dev-token",
        origin: "https://example.test",
        token: "dev-token",
      }),
    ).toEqual({ message: "Forbidden origin", ok: false, status: 403 });
  });

  it("rejects missing request tokens when a token is configured", () => {
    expect(
      validateCodexPostRequest({
        contentType: "application/json",
        expectedToken: "dev-token",
        origin: "http://127.0.0.1:5173",
      }),
    ).toEqual({ message: `Missing or invalid ${codexRequestTokenHeader}`, ok: false, status: 403 });
  });

  it("rejects non-JSON POST bodies", () => {
    expect(
      validateCodexPostRequest({
        contentType: "text/plain",
        origin: "http://127.0.0.1:5173",
      }),
    ).toEqual({ message: "Content-Type must be application/json", ok: false, status: 415 });
  });

  it("uses the request origin for CORS only when it is allowed", () => {
    expect(dashboardCorsOrigin("http://127.0.0.1:5175")).toBe("http://127.0.0.1:5175");
    expect(dashboardCorsOrigin("https://example.test")).toBe(defaultDashboardOrigins[0]);
  });

  it("parses comma-separated dashboard origins and falls back to defaults", () => {
    expect(parseDashboardOrigins(" http://127.0.0.1:5199, http://localhost:5199 ")).toEqual([
      "http://127.0.0.1:5199",
      "http://localhost:5199",
    ]);
    expect(parseDashboardOrigins(" , ")).toEqual(defaultDashboardOrigins);
  });
});
