import { describe, expect, test } from "bun:test";
import pkg from "../package.json" with { type: "json" };
import { createApp } from "./app";
import { clientHeader } from "./http/csrf";

const app = createApp();
const graphql = (query: string, headers: Record<string, string> = {}) =>
  app.fetch(
    new Request("http://localhost/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ query }),
    }),
  );

describe("probes", () => {
  // No x-storix-client, no proxy secret: the probes are reached by the platform.
  test("GET /health answers 200 with no header and no secret", async () => {
    const response = await app.fetch(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
  });

  test("GET /ready answers 200 while MongoDB answers, with no header and no secret", async () => {
    const response = await app.fetch(new Request("http://localhost/ready"));
    expect(response.status).toBe(200);
  });

  test("GET /ready answers 503 when the MongoDB check fails", async () => {
    const down = createApp({ mongo: async () => false });
    const response = await down.fetch(new Request("http://localhost/ready"));
    expect(response.status).toBe(503);
    const health = await down.fetch(new Request("http://localhost/health"));
    expect(health.status).toBe(200);
  });
});

describe("graphql", () => {
  test("version answers the package version", async () => {
    const response = await graphql("{ version }", { [clientHeader]: "spec" });
    expect(await response.json()).toEqual({ data: { version: pkg.version } });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  test("a request without the client header is refused 403", async () => {
    const response = await graphql("{ version }");
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).toContain(
      "auth.errors.client-header-required",
    );
  });

  test("a whitespace-only client header is refused 403", async () => {
    const response = await graphql("{ version }", { [clientHeader]: "   " });
    expect(response.status).toBe(403);
  });

  test("a GET /graphql query without the client header is refused 403", async () => {
    const response = await app.fetch(
      new Request("http://localhost/graphql?query=%7Bversion%7D"),
    );
    expect(response.status).toBe(403);
  });

  test("the sandbox page (GET with Accept: text/html) is not blocked", async () => {
    const response = await app.fetch(
      new Request("http://localhost/graphql", {
        headers: { accept: "text/html" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });
});
