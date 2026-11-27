#!/usr/bin/env bun
/**
 * Deploys the storix-api staging stack on this machine, by hand and
 * idempotently: git pull the checkout, build the images here (there is no
 * registry), `up --wait` until every service is healthy. A rerun with nothing
 * changed pulls nothing, rebuilds from cache and recreates no container; only
 * the health wait does work. The `migrate` one-shot (db:sync, then db:migrate
 * of the core and every workspace database) runs in the new image before the
 * API and the worker roll; a boot with a migration pending refuses to start.
 * One deploy at a time on the host: run it as
 * `flock /tmp/deploy.lock bun deploy/deploy.ts ...`.
 *
 *   bun deploy/deploy.ts [--env deploy/.env] [--prefix staging]
 *                        [--no-pull] [--ui] [--backup]
 *                        [--timeout 300] [--dry-run]
 *
 *   --env      the stack's env file (default deploy/.env); it must exist and be
 *              mode 600, or the script refuses to run
 *   --prefix   STACK_PREFIX, overriding the file (a second stack)
 *   --no-pull  skip `git pull` (a checkout on a feature branch)
 *   --ui       also build and start storix-ui (compose profile `ui`)
 *   --backup   also build and start the offsite backup (compose profile `backup`)
 *              and require its BACKUP_S3_* settings; without it the backup is
 *              off and nothing about it is required
 *   --dry-run  print the plan and what the env file lacks, then stop: no git,
 *              no docker, no network, nothing written. Exit 1
 *              when the env file has problems, so it doubles as a preflight
 *
 * The backup service (nightly dump, offsite copy) is opt-in: with --backup its
 * BACKUP_S3_* settings are checked before anything is built; without it one
 * line says the backup is off. restore.ts and restore-drill.ts bring data back
 * and prove a dump restores.
 */

import { existsSync, statSync } from "node:fs";
import { $ } from "bun";
import {
  API_ROOT,
  DEPLOY_DIR,
  ensureReadToken,
  fail,
  flagValue,
  loadStack,
  parseEnv,
  resolvePrefix,
  uiContext,
} from "./lib";
import {
  BACKUP_OFF_LINE,
  deploySteps,
  envProblems,
  MAIL_KEY_FILE,
  mailProblems,
  renderPlan,
  staleImages,
} from "./plan";

// The bumail service key file, found or not (its content is never read here).
function mailKeyFile() {
  const path = `${DEPLOY_DIR}/${MAIL_KEY_FILE}`;
  return existsSync(path)
    ? { exists: true, mode: statSync(path).mode & 0o777 }
    : { exists: false, mode: 0 };
}

const args = Bun.argv.slice(2);
const known = new Set([
  "--env",
  "--prefix",
  "--no-pull",
  "--ui",
  "--backup",
  "--timeout",
  "--dry-run",
]);
for (const a of args) {
  if (a.startsWith("--") && !known.has(a)) fail(`unknown flag ${a}`);
}

const timeout = flagValue(args, "--timeout") ?? "300";
if (!/^[1-9][0-9]*$/.test(timeout)) fail("--timeout is a number of seconds");
const options = {
  noPull: args.includes("--no-pull"),
  ui: args.includes("--ui"),
  backup: args.includes("--backup"),
  timeout,
};
const step = (name: string, detail = "") =>
  console.log(`  ${name.padEnd(9)} ${detail}`);

if (args.includes("--dry-run")) {
  // Local reads only: the env file, if there is one. Nothing is spawned.
  const envFile = flagValue(args, "--env") ?? `${DEPLOY_DIR}/.env`;
  const values = existsSync(envFile)
    ? parseEnv(await Bun.file(envFile).text())
    : {};
  let prefix: string;
  try {
    prefix = resolvePrefix(flagValue(args, "--prefix"), values["STACK_PREFIX"]);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const namePrefix = prefix ? `${prefix}-` : "";
  const compose = `docker compose -f ${DEPLOY_DIR}/docker-compose.yaml --env-file ${envFile}`;
  console.log(
    `dry run: nothing is pulled, built, started or written (env file ${envFile}, stack ${prefix || "default"})`,
  );
  console.log(
    renderPlan(
      deploySteps({
        options,
        apiRoot: API_ROOT,
        uiRoot: uiContext(values),
        compose,
        namePrefix,
      }),
    ),
  );
  if (!options.backup) console.log(`\n${BACKUP_OFF_LINE}`);
  const problems = existsSync(envFile)
    ? [
        ...envProblems(values, { backup: options.backup }),
        ...mailProblems(values, mailKeyFile()),
      ]
    : [`${envFile} is missing: cp deploy/.env.example ${envFile}, fill it`];
  if (problems.length > 0) {
    console.log(`\nthe real run would stop on:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log("\nthe env file is complete; the real run would go ahead");
  process.exit(0);
}

// The images' `bun install` reads @softistx from npmjs with this token (a BuildKit
// secret of the compose file): set before loadStack copies the environment.
ensureReadToken();
const stack = await loadStack(args);

const problems = [
  ...envProblems(stack.values, { backup: options.backup }),
  ...mailProblems(stack.values, mailKeyFile()),
];
if (problems.length > 0)
  fail(`the settings in ${stack.envFile}:\n  ${problems.join("\n  ")}`);

const proxy = await $`docker network inspect proxy`.quiet().nothrow();
if (proxy.exitCode !== 0)
  fail(
    "the external docker network `proxy` does not exist (nxgt-docker creates it)",
  );
const bumailNetwork = await $`docker network inspect bumail-internal`
  .quiet()
  .nothrow();
if (bumailNetwork.exitCode !== 0)
  fail(
    "the external docker network `bumail-internal` does not exist (bumail's stack creates it)",
  );

if (!options.noPull) {
  const dirs = options.ui ? [API_ROOT, uiContext(stack.values)] : [API_ROOT];
  for (const dir of dirs) {
    const out = (await $`git pull --ff-only`.cwd(dir).text())
      .trim()
      .split("\n")
      .pop();
    step("pull", `${dir}: ${out}`);
  }
} else {
  step("skip", "git pull (--no-pull)");
}

const profile = [
  ...(options.ui ? ["--profile", "ui"] : []),
  ...(options.backup ? ["--profile", "backup"] : []),
];
if (!options.backup) step("backup", BACKUP_OFF_LINE);
step(
  "build",
  `api, ${options.backup ? "backup, " : ""}s3-init (cached layers make a rerun cheap)`,
);
await stack.compose(...profile, "build");

// db:sync and db:migrate in the new image, against the running data services,
// before the api and the worker roll: a failure stops here, the old containers
// are still up.
step("migrate", "db:sync, then db:migrate (core and every workspace database)");
await stack.compose("--profile", "ops", "run", "--rm", "migrate");

step("up", "");
await stack.compose(
  ...profile,
  "up",
  "-d",
  "--remove-orphans",
  "--wait",
  "--wait-timeout",
  timeout,
);

await stack.compose(
  ...profile,
  "ps",
  "--format",
  "table {{.Name}}\t{{.Status}}",
);
step("healthy", `${stack.namePrefix}storix is up`);

// Free the disk once the new containers are healthy (never before: a failed deploy
// keeps the old images to roll back to). Only this app's images; never
// `system prune -a` nor `--volumes`.
const lines = async (cmd: Promise<{ stdout: Buffer }>) =>
  (await cmd).stdout
    .toString()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
await $`docker image prune -f`.quiet().nothrow();
const stale = staleImages({
  images: await lines(
    $`docker image ls --format ${"{{.Repository}}:{{.Tag}}"}`.quiet().nothrow(),
  ),
  inUse: await lines(
    $`docker ps -a --format ${"{{.Image}}"}`.quiet().nothrow(),
  ),
  keepTag: process.env["TAG"] ?? stack.values["TAG"] ?? "local",
  namePrefix: stack.namePrefix,
});
for (const ref of stale) await $`docker rmi ${ref}`.quiet().nothrow();
await $`docker builder prune -f --filter until=24h`.quiet().nothrow();
step(
  "prune",
  `${stale.length} old storix image tag(s) removed, build cache > 24 h`,
);
