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
  test("GET /health answers 200", async () => {
    const response = await app.fetch(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
  });

  test("GET /ready answers 200 while MongoDB answers", async () => {
    const response = await app.fetch(new Request("http://localhost/ready"));
    expect(response.status).toBe(200);
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
  });
});
