// CORS for the chat-first web entry routes (ux-flow §7.2). The older paths are covered by test/app.test.ts.
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { PUBLIC_CORS_PATHS, publicCors } from "./cors";
import { env } from "./env";

const app = new Hono();
for (const path of PUBLIC_CORS_PATHS) app.use(path, publicCors);
app.get("/plans/:code", (c) => c.json({ ok: true }));
app.get("/status", (c) => c.json({ ok: true }));

const preflight = (path: string, origin = env.WEB_ORIGIN) =>
  app.request(path, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });

describe("public CORS paths", () => {
  it.each(["/start", "/status", "/plans/4821", "/join", "/plans"])("%s preflight allows GET and POST from WEB_ORIGIN", async (path) => {
    const res = await preflight(path);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(env.WEB_ORIGIN);
    expect(res.headers.get("access-control-allow-methods")).toBe("GET,POST");
  });

  it("a GET /plans/:code from WEB_ORIGIN carries the allow-origin header; another origin does not", async () => {
    const ok = await app.request("/plans/4821", { headers: { Origin: env.WEB_ORIGIN } });
    expect(ok.headers.get("access-control-allow-origin")).toBe(env.WEB_ORIGIN);
    const evil = await app.request("/status?t=x", { headers: { Origin: "https://evil.example" } });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("does not leak to deeper paths", async () => {
    const res = await preflight("/plans/4821/extra");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
