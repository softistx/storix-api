import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "jobs", "jobs-loop");
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jobs-loop-"));
  // The stand-in for `bun --no-install <script>`: records the script, fails
  // for the one named in FAIL.
  await writeFile(
    join(dir, "run.sh"),
    `echo "$1" >> "${dir}/calls"\n[ "$1" = "$FAIL" ] && exit 3\nexit 0\n`,
  );
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function loop(env: Record<string, string>) {
  const proc = Bun.spawn(["bash", script], {
    env: {
      PATH: Bun.env["PATH"] ?? "",
      JOBS_RUN: `bash ${join(dir, "run.sh")}`,
      JOBS_ALIVE_FILE: join(dir, "alive"),
      JOBS_TICK: "1",
      JOBS_MAX_TICKS: "1",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const calls = await readFile(join(dir, "calls"), "utf8").catch(() => "");
  return { out, err, code, calls: calls.split("\n").filter(Boolean) };
}

describe("jobs-loop", () => {
  test("the first tick runs the three scripts, in order, and stamps the heartbeat", async () => {
    const { calls, code } = await loop({});
    expect(code).toBe(0);
    expect(calls).toEqual([
      "dist/scripts/storage-sweep.js",
      "dist/scripts/retention.js",
      "dist/scripts/quota-reconcile.js",
    ]);
    const alive = Number(await readFile(join(dir, "alive"), "utf8"));
    expect(Date.now() / 1000 - alive).toBeLessThan(30);
  });

  test("a failing script is logged and does not stop the others", async () => {
    const { calls, err, code } = await loop({
      FAIL: "dist/scripts/retention.js",
    });
    expect(code).toBe(0);
    expect(calls).toHaveLength(3);
    expect(err).toContain("retention failed (exit 3)");
  });

  test("a job is not run again before its interval", async () => {
    const { calls } = await loop({
      JOBS_MAX_TICKS: "3",
      JOBS_SWEEP_EVERY: "3600",
      JOBS_RETENTION_EVERY: "3600",
      JOBS_RECONCILE_EVERY: "3600",
    });
    expect(calls).toHaveLength(3);
  });

  test("a job whose interval is short runs on each tick", async () => {
    const { calls } = await loop({
      JOBS_MAX_TICKS: "3",
      JOBS_SWEEP_EVERY: "1",
    });
    expect(
      calls.filter((c) => c === "dist/scripts/storage-sweep.js").length,
    ).toBeGreaterThanOrEqual(2);
  });

  test("a bad interval stops the loop before any run", async () => {
    const { code, err, calls } = await loop({ JOBS_SWEEP_EVERY: "soon" });
    expect(code).toBe(1);
    expect(err).toContain("storage-sweep interval");
    expect(calls).toEqual([]);
  });
});
