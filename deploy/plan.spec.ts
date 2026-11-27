import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "./lib";
import {
  deploySteps,
  envProblems,
  REQUIRED,
  renderPlan,
  staleImages,
} from "./plan";

const example = parseEnv(
  readFileSync(join(import.meta.dir, ".env.example"), "utf8"),
);
const filled = Object.fromEntries(
  Object.entries(example).map(([k, v]) => [
    k,
    v === "CHANGE_ME" ? "a1b2c3" : v,
  ]),
);
// The backup settings, commented out in the example (opt-in).
const backupValues = {
  MONGO_BACKUP_PASSWORD: "a1b2c3",
  BACKUP_S3_ENDPOINT: "https://s3.example.test",
  BACKUP_S3_BUCKET: "bucket",
  BACKUP_S3_ACCESS_KEY: "a1b2c3",
  BACKUP_S3_SECRET_KEY: "a1b2c3",
};
const withBackup = { ...filled, ...backupValues };

describe("envProblems", () => {
  test(".env.example names every required variable, all still CHANGE_ME", () => {
    for (const name of REQUIRED) expect(example).toHaveProperty(name);
    const problems = envProblems(example);
    for (const name of REQUIRED.filter((n) => example[n] === "CHANGE_ME")) {
      expect(problems.some((p) => p.startsWith(name))).toBe(true);
    }
  });

  test("a filled file has no problem", () => {
    expect(envProblems(filled)).toEqual([]);
  });

  test("without --backup nothing about the backup is required or checked", () => {
    expect(envProblems(filled)).toEqual([]);
    expect(envProblems({ ...filled, BACKUP_S3_ENDPOINT: "nonsense" })).toEqual(
      [],
    );
  });

  test("with --backup a filled file has no problem", () => {
    expect(envProblems(withBackup, { backup: true })).toEqual([]);
  });

  test("with --backup the missing offsite settings and backup password are reported once each", () => {
    const problems = envProblems(filled, { backup: true });
    for (const name of Object.keys(backupValues))
      expect(problems.filter((p) => p.startsWith(name))).toHaveLength(1);
    expect(
      envProblems(
        { ...withBackup, BACKUP_S3_ENDPOINT: "ftp://x" },
        { backup: true },
      ),
    ).toEqual(["BACKUP_S3_ENDPOINT must be an http:// or https:// URL"]);
  });

  test("reports a missing name once", () => {
    const { REDIS_PASSWORD: _a, ...rest } = filled;
    const problems = envProblems(rest);
    expect(problems.filter((p) => p.startsWith("REDIS_PASSWORD"))).toHaveLength(
      1,
    );
  });

  test("refuses a URL password that needs escaping and an http scheme", () => {
    const problems = envProblems({
      ...filled,
      REDIS_PASSWORD: "p@ss/word",
      PUBLIC_SCHEME: "http",
      UI_HOSTNAME: "https://storix.softistx.com/",
    });
    expect(problems.join("\n")).toContain("REDIS_PASSWORD must use");
    expect(problems.join("\n")).toContain("PUBLIC_SCHEME must be https");
    expect(problems.join("\n")).toContain("UI_HOSTNAME must be a bare");
  });
});

describe("deploySteps", () => {
  const input = {
    options: { noPull: false, ui: false, backup: false, timeout: "300" },
    apiRoot: "/srv/storix-api",
    uiRoot: "/srv/storix-ui",
    compose: "docker compose -f c.yaml --env-file e",
    namePrefix: "",
  };
  const names = (steps: ReturnType<typeof deploySteps>) =>
    steps.map((s) => s.name);

  test("check, network, pull, build, migrate, up, status, in that order", () => {
    expect(names(deploySteps(input))).toEqual([
      "check",
      "network",
      "pull",
      "build",
      "migrate",
      "up",
      "status",
      "prune",
      "untag",
      "cache",
    ]);
  });

  test("prunes only after the stack is up and healthy, never system-wide nor volumes", () => {
    const steps = deploySteps(input);
    const order = names(steps);
    expect(order.indexOf("prune")).toBeGreaterThan(order.indexOf("up"));
    expect(order.indexOf("prune")).toBeGreaterThan(order.indexOf("status"));
    const commands = steps.map((s) => s.command ?? "");
    expect(commands).toContain("docker image prune -f");
    expect(commands).toContain("docker builder prune -f --filter until=24h");
    const text = commands.join("\n");
    expect(text).not.toMatch(/system prune/);
    expect(text).not.toMatch(/--volumes/);
    expect(text).not.toMatch(/prune -a/);
    expect(text).not.toMatch(/-a\b.*prune/);
  });

  test("the untag step names this stack's prefixed repositories only", () => {
    const untag = deploySteps({ ...input, namePrefix: "staging-" }).find(
      (s) => s.name === "untag",
    );
    expect(untag?.detail).toContain("staging-storix-api");
    expect(untag?.detail).toContain("staging-storix-ui");
  });

  test("--no-pull skips the pull, --ui adds the UI checkout and profile", () => {
    expect(
      names(
        deploySteps({ ...input, options: { ...input.options, noPull: true } }),
      ),
    ).toContain("skip");
    const ui = deploySteps({
      ...input,
      options: { ...input.options, ui: true },
    });
    expect(ui.filter((s) => s.name === "pull")).toHaveLength(2);
    expect(ui.find((s) => s.name === "up")?.command).toContain("--profile ui");
    expect(
      deploySteps(input).find((s) => s.name === "up")?.command,
    ).not.toContain("--profile");
  });

  test("--backup adds the backup profile and the backup image; without it neither appears", () => {
    const off = deploySteps(input);
    for (const s of off) {
      expect(s.command ?? "").not.toContain("--profile backup");
      expect(s.detail).not.toMatch(/\bbackup,/);
    }
    const on = deploySteps({
      ...input,
      options: { ...input.options, backup: true, ui: true },
    });
    const build = on.find((s) => s.name === "build");
    expect(build?.command).toContain("--profile ui --profile backup build");
    expect(build?.detail).toContain("backup, s3-init");
    expect(on.find((s) => s.name === "up")?.command).toContain(
      "--profile backup",
    );
  });

  test("waits for healthy containers for the given timeout", () => {
    const up = deploySteps({
      ...input,
      options: { ...input.options, timeout: "90" },
    }).find((s) => s.name === "up");
    expect(up?.command).toContain("--wait --wait-timeout 90");
  });

  test("renders one numbered line per step, a command under its step", () => {
    const text = renderPlan(deploySteps(input));
    expect(text.split("\n").filter((l) => /^\s+\d+\./.test(l))).toHaveLength(
      10,
    );
    expect(text).toContain("$ git -C /srv/storix-api pull --ff-only");
  });
});

describe("staleImages", () => {
  const base = { keepTag: "local", namePrefix: "" };

  test("lists the previous tags of this app's images, not the current or running ones", () => {
    expect(
      staleImages({
        ...base,
        images: [
          "storix-api:local",
          "storix-api:abc123",
          "storix-api:def456",
          "storix-ui:old",
          "storix-s3-init:v1",
          "storix-backup:v0",
        ],
        inUse: ["storix-api:def456", "storix-ui:local"],
      }),
    ).toEqual([
      "storix-api:abc123",
      "storix-ui:old",
      "storix-s3-init:v1",
      "storix-backup:v0",
    ]);
  });

  test("never lists another product's image, another stack's prefix, a dangling image or a third-party one", () => {
    expect(
      staleImages({
        ...base,
        images: [
          "operix-api:old",
          "schoolz-ui:old",
          "staging-storix-api:old",
          "storix-api-extra:old",
          "storix-api:<none>",
          "<none>:<none>",
          "mongo:8.3",
          "cgr.dev/chainguard/minio:latest",
          "localhost:5000/storix-api:old",
          "storix-api",
        ],
        inUse: [],
      }),
    ).toEqual([]);
  });

  test("a prefixed stack lists only its own prefixed repositories", () => {
    expect(
      staleImages({
        images: ["staging-storix-api:old", "storix-api:old"],
        inUse: [],
        keepTag: "local",
        namePrefix: "staging-",
      }),
    ).toEqual(["staging-storix-api:old"]);
  });
});
