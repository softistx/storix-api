import { describe, expect, test } from "bun:test";
import { clientIp, PROXY_SECRET_HEADER } from "./client-ip";

const SECRET = "s".repeat(32);
const PROXY = "10.0.0.5";
// A connection from the trusted proxy; the forwarded entry is the client.
const server = { requestIP: () => ({ address: PROXY, port: 1 }) } as never;
const trusted = ["10.0.0.0/8"];

const ipOf = (
  options: Parameters<typeof clientIp>[0],
  path: string,
  headers: Record<string, string> = {},
) =>
  clientIp(options)(
    new Request(`http://localhost${path}`, {
      headers: { "x-forwarded-for": "203.0.113.9", ...headers },
    }),
    server,
  );

describe("clientIp", () => {
  test("honours the forwarded address with a valid secret", () => {
    const ip = ipOf({ trusted, secret: SECRET }, "/graphql", {
      [PROXY_SECRET_HEADER]: SECRET,
    });
    expect(ip).toBe("203.0.113.9");
  });

  test("answers the connection's address without the secret header", () => {
    expect(ipOf({ trusted, secret: SECRET }, "/graphql")).toBe(PROXY);
  });

  test("answers the connection's address with a wrong secret", () => {
    const ip = ipOf({ trusted, secret: SECRET }, "/graphql", {
      [PROXY_SECRET_HEADER]: "x".repeat(32),
    });
    expect(ip).toBe(PROXY);
  });

  test("/public/ is exempt: the forwarded address needs no secret", () => {
    expect(ipOf({ trusted, secret: SECRET }, "/public/x")).toBe("203.0.113.9");
  });

  test("without API_PROXY_SECRET, TRUSTED_PROXIES alone decides", () => {
    expect(ipOf({ trusted }, "/graphql")).toBe("203.0.113.9");
  });

  test("a connection from outside TRUSTED_PROXIES is the client, secret or not", () => {
    const outside = { requestIP: () => ({ address: "198.51.100.1", port: 1 }) };
    const ip = clientIp({ trusted, secret: SECRET })(
      new Request("http://localhost/graphql", {
        headers: {
          "x-forwarded-for": "203.0.113.9",
          [PROXY_SECRET_HEADER]: SECRET,
        },
      }),
      outside as never,
    );
    expect(ip).toBe("198.51.100.1");
  });
});
