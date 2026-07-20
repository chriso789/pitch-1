// Shared HTTP client for authenticated ABC API calls.
//
// Extracted from `callAbc` in both handlers. Behaviour:
//   • Sends the ABC-approved browser-ish headers Sandy validated during
//     Sandbox onboarding.
//   • Parses JSON when possible; always returns raw text for auditing.
//   • Converts Imperva/Incapsula WAF challenges into a stable `499`
//     sentinel with `json.waf === true`, so `mapAbcError` returns
//     `abc_waf_blocked` instead of leaking the underlying `403` / `503`.

import { detectWaf } from "./waf.ts";

export interface AbcHttpResult {
  status: number;
  json: any;
  text: string;
  ok: boolean;
  headers: Record<string, string>;
}

export async function callAbc(
  token: string,
  method: "GET" | "POST",
  url: string,
  body?: unknown,
): Promise<AbcHttpResult> {
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep text-only response */
  }
  const headers: Record<string, string> = {};
  resp.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  if (!resp.ok && detectWaf(resp.status, text)) {
    return {
      status: 499,
      json: { waf: true, upstream_status: resp.status },
      text,
      ok: false,
      headers,
    };
  }
  return { status: resp.status, json, text, ok: resp.ok, headers };
}
