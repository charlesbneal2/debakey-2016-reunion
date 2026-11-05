const LOCALHOST = /^http:\/\/localhost(:\d+)?$/;

export function corsHeaders(origin: string | null, siteUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin",
  };
  if (origin && (origin === siteUrl || LOCALHOST.test(origin))) {
    headers["access-control-allow-origin"] = origin;
  }
  return headers;
}

export function json(data: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
