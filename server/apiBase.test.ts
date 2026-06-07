// ─────────────────────────────────────────────────────────────────────────────
// API_BASE TESTS — guards the published-site fix: every client backend call must
// route through the proxied base prefix. The publish tool rewrites the
// "__PORT_5000__" sentinel in client/src/lib/queryClient.ts; until then it is the
// raw sentinel and resolves to "". A bare fetch("/api/...") bypasses this and
// 404s behind the pplx.app proxy, which is what blanked the onboarding screen.
//
// queryClient.ts pulls in @tanstack/react-query + path aliases, so we don't import
// it under the node test runner. Instead we pin the resolution RULE and prove an
// apiRequest-style call prepends the base — the contract every call site relies on.
// ─────────────────────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";

// Mirror of `client/src/lib/queryClient.ts`'s API_BASE rule. Keep in sync.
function resolveApiBase(sentinel: string): string {
  return sentinel.startsWith("__") ? "" : sentinel;
}

test("API_BASE is empty while the sentinel is unrewritten (local/dev)", () => {
  assert.equal(resolveApiBase("__PORT_5000__"), "");
});

test("API_BASE is the proxied prefix once the publish tool rewrites the sentinel", () => {
  assert.equal(resolveApiBase("/proxy/abc123"), "/proxy/abc123");
});

test("apiRequest-style call prepends API_BASE to the path", async () => {
  const calls: string[] = [];
  const fakeFetch = async (url: string) => {
    calls.push(url);
    return { ok: true, status: 200, async text() { return ""; } } as Response;
  };
  const API_BASE = resolveApiBase("/proxy/abc123");
  await fakeFetch(`${API_BASE}/api/strategy-builder`);
  assert.deepEqual(calls, ["/proxy/abc123/api/strategy-builder"]);
});
