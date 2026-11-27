import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  composeEnv,
  DEPLOY_DIR,
  mongoRootUri,
  parseEnv,
  resolvePrefix,
} from "./lib";

describe("parseEnv", () => {
  test("skips comments and blanks, strips one pair of quotes", () => {
    expect(parseEnv("# c\n\nA=1\nB=\"two words\"\nC='x'\n")).toEqual({
      A: "1",
      B: "two words",
      C: "x",
    });
  });

  test("drops an inline comment of an unquoted value, as compose does", () => {
    expect(parseEnv("A=value # note\nB=a#b\nC=\n")).toEqual({
      A: "value",
      B: "a#b",
      C: "",
    });
  });

  test("a quoted value keeps its # and ends at the closing quote", () => {
    expect(parseEnv("A=\"x # y\" # note\nB='p q'\n")).toEqual({
      A: "x # y",
      B: "p q",
    });
  });
});

describe("composeEnv", () => {
  test("unsets the shell exports the file defines, keeps the others", () => {
    const env = composeEnv(
      { REDIS_PASSWORD: "stale", PATH: "/bin", HOME: "/h" },
      { REDIS_PASSWORD: "fresh" },
      "",
    );
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", STACK_PREFIX: "" });
    expect("REDIS_PASSWORD" in env).toBe(false);
  });

  test("never carries the file's values: compose reads them from --env-file", () => {
    const env = composeEnv({}, { A: "1 # inline" }, "demo");
    expect(env).toEqual({ STACK_PREFIX: "demo" });
  });

  test("STACK_PREFIX is the resolved prefix, whatever the shell exported", () => {
    expect(composeEnv({ STACK_PREFIX: "stale" }, {}, "")["STACK_PREFIX"]).toBe(
      "",
    );
    expect(
      composeEnv({ STACK_PREFIX: "stale" }, { STACK_PREFIX: "x" }, "x")[
        "STACK_PREFIX"
      ],
    ).toBe("x");
  });
});

describe("resolvePrefix", () => {
  test("the flag fills an empty prefix, the file's value is the default", () => {
    expect(resolvePrefix("demo", undefined)).toBe("demo");
    expect(resolvePrefix("demo", "")).toBe("demo");
    expect(resolvePrefix(undefined, "demo")).toBe("demo");
    expect(resolvePrefix(undefined, undefined)).toBe("");
    expect(resolvePrefix("demo", "demo")).toBe("demo");
  });

  test("a flag that differs from a non-empty STACK_PREFIX is refused", () => {
    expect(() => resolvePrefix("demo", "prod2")).toThrow(
      /differs from STACK_PREFIX=prod2/,
    );
  });
});

// Compose interpolation, written without a template-looking string.
const v = (expr: string) => ["$", "{", expr, "}"].join("");

describe("the compose file", () => {
  // Comment lines apart: they cite names that are not configuration.
  const compose = readFileSync(join(DEPLOY_DIR, "docker-compose.yaml"), "utf8")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  const example = parseEnv(
    readFileSync(join(DEPLOY_DIR, ".env.example"), "utf8"),
  );

  test("publishes no port and has no MCP, jobs or media router", () => {
    expect(compose).not.toMatch(/^\s+ports:/m);
    expect(compose).not.toContain("MCP_HOSTNAME");
    expect(compose).not.toContain("MEDIA_HOSTNAME");
    const rules = compose.split("\n").filter((l) => l.includes(".rule="));
    // The API's /public/ router and the UI's.
    expect(rules).toHaveLength(2);
    for (const rule of rules)
      expect(rule).toContain(`Host(\`${v("UI_HOSTNAME:?")}\`)`);
  });

  test("every required variable is listed in .env.example", () => {
    const required = [...compose.matchAll(/\$\{([A-Z0-9_]+):\?/g)].map(
      (m) => m[1] as string,
    );
    expect(required.length).toBeGreaterThan(5);
    for (const name of required) expect(name in example).toBe(true);
  });

  test("container names start with storix-, never another product's", () => {
    expect(compose).not.toContain("self-learning-");
    const names = [...compose.matchAll(/container_name: (\S+)/g)].map(
      (m) => m[1] as string,
    );
    expect(names.length).toBe(11);
    const prefix = `${v(`STACK_PREFIX:+${v("STACK_PREFIX")}-`)}storix-`;
    for (const n of names) expect(n.startsWith(prefix)).toBe(true);
  });
});

describe("mongoRootUri", () => {
  test("names the replica set and the auth database, with no database in the path", () => {
    expect(mongoRootUri("demo-", "pw")).toBe(
      "mongodb://root:pw@demo-storix-mongo:27017/?replicaSet=rs0&authSource=admin",
    );
  });
});
