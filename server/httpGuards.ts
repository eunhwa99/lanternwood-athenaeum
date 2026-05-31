export const codexRequestTokenHeader = "x-lanternwood-codex-token";
export const defaultDashboardOrigins = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:5175",
  "http://localhost:5175",
] as const;

type GuardInput = {
  allowedOrigins?: readonly string[];
  contentType?: string;
  expectedToken?: string;
  origin?: string;
  token?: string;
};

type GuardResult =
  | {
      ok: true;
    }
  | {
      message: string;
      ok: false;
      status: number;
    };

function isJsonContentType(contentType: string | undefined) {
  return contentType?.toLowerCase().split(";")[0]?.trim() === "application/json";
}

function isLocalHttpOrigin(value: string) {
  try {
    const url = new URL(value);
    return (
      url.origin === value &&
      url.protocol === "http:" &&
      Boolean(url.port) &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

export function parseDashboardOrigins(value = process.env.LANTERNWOOD_DASHBOARD_ORIGINS): readonly string[] {
  const configured = value
    ?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin && isLocalHttpOrigin(origin));

  return configured?.length ? configured : defaultDashboardOrigins;
}

function isAllowedDashboardOrigin(origin: string | undefined, allowedOrigins = parseDashboardOrigins()) {
  return !origin || allowedOrigins.includes(origin);
}

export function dashboardCorsOrigin(origin: string | undefined, allowedOrigins = parseDashboardOrigins()) {
  return isAllowedDashboardOrigin(origin, allowedOrigins) && origin ? origin : allowedOrigins[0];
}

export function validateCodexPostRequest({
  allowedOrigins,
  contentType,
  expectedToken,
  origin,
  token,
}: GuardInput): GuardResult {
  if (!isJsonContentType(contentType)) {
    return { message: "Content-Type must be application/json", ok: false, status: 415 };
  }

  if (!isAllowedDashboardOrigin(origin, allowedOrigins)) {
    return { message: "Forbidden origin", ok: false, status: 403 };
  }

  if (expectedToken && token !== expectedToken) {
    return { message: `Missing or invalid ${codexRequestTokenHeader}`, ok: false, status: 403 };
  }

  return { ok: true };
}
