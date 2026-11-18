const baseCorsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function cleanOriginList(): string[] {
  const configured = (Deno.env.get("ALLOWED_ORIGINS") || "").replace(/[\x00-\x1F\x7F-\x9F\uFEFF]/g, "").split(",").map((value) => value.trim()).filter(Boolean);
  return configured.length ? configured : ["http://localhost:5500", "http://localhost:8000"];
}

export function corsHeadersFor(origin: string | null) {
  const headers = new Headers(baseCorsHeaders);
  if (origin && cleanOriginList().includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

export function withCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  const allowed = corsHeadersFor(origin);
  headers.delete("Access-Control-Allow-Origin");
  headers.delete("Vary");
  for (const [name, value] of allowed.entries()) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const corsHeaders = baseCorsHeaders;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: baseCorsHeaders });
}
