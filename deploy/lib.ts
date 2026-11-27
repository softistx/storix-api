/**
 * What deploy.ts shares with the specs: reading the stack's env file, refusing a
 * file that others can read, and building the `docker compose` invocation.
 * It lives here, beside the compose files, because deploy.ts is the only
 * caller: nothing else in the repository drives the stack.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { $ } from "bun";

export const DEPLOY_DIR = dirname(new URL(import.meta.url).pathname);
export const API_ROOT = resolve(DEPLOY_DIR, "..");

/** A flag's value (`--env file`), or undefined. Exits on a flag with no value. */
export function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--"))
    fail(`${name} needs a value`);
  return value;
}

export function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

/**
 * Makes the npm read token (`NPM_SOFTISTX_READ_TOKEN`, it reads @softistx on npmjs)
 * available to the builds: the environment's value, else the host's secrets file.
 * Never fails and never prints the token: unset only warns, since installs work
 * while the packages are public (softistx/plugins#233). Call it before loadStack
 * (which copies the environment) and before any install.
 */
export function ensureReadToken(): void {
  if (process.env["NPM_SOFTISTX_READ_TOKEN"]) return;
  const file = join(homedir(), ".config/secrets/npm-sofistx-read-token");
  const token = existsSync(file) ? readFileSync(file, "utf8").trim() : "";
  if (token) process.env["NPM_SOFTISTX_READ_TOKEN"] = token;
  else
    console.warn(
      "warning: NPM_SOFTISTX_READ_TOKEN unset: @softistx installs work only while the packages are public (plugins#233)",
    );
}

/** Refuses a missing env file, or one anybody but the owner can read. */
export function checkEnvFile(path: string): void {
  if (!existsSync(path)) {
    fail(
      `${path} is missing: cp deploy/.env.example ${path}, fill it, chmod 600 ${path}`,
    );
  }
  const mode = statSync(path).mode & 0o777;
  if (mode !== 0o600 && mode !== 0o400) {
    fail(
      `${path} has mode ${mode.toString(8)}, it holds secrets: chmod 600 ${path}`,
    );
  }
}

/**
 * KEY=VALUE lines; comments and blank lines skipped. A quoted value ends at its
 * closing quote (what follows is dropped); an unquoted one ends at a ` #`, as
 * compose reads it, so the script and compose see the same value.
 */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    const quoted = /^(["'])(.*?)\1(?:\s+#.*)?$/.exec(value);
    if (quoted) value = quoted[2] ?? "";
    else value = value.replace(/\s+#.*$/, "");
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

/**
 * The stack's prefix: `--prefix` or the file's STACK_PREFIX. A `--prefix` that
 * differs from a non-empty STACK_PREFIX in the file is refused: the file's
 * hostnames would be routed to the other stack (a demo answering on the
 * production names).
 */
export function resolvePrefix(
  flag: string | undefined,
  fileValue: string | undefined,
): string {
  if (flag !== undefined && fileValue && flag !== fileValue) {
    throw new Error(
      `--prefix ${flag} differs from STACK_PREFIX=${fileValue} in the env file: the file's hostnames would be routed to the wrong stack. Use another env file for another stack (--env), with its own hostnames`,
    );
  }
  return flag ?? fileValue ?? "";
}

/**
 * The environment of the compose process: the shell's, minus every name the env
 * file defines, plus STACK_PREFIX. The file's values are supplied by compose's
 * own `--env-file`, so compose alone reads them (one parser, no inline-comment
 * or quoting disagreement) and a stale shell export cannot override them.
 */
export function composeEnv(
  shell: Record<string, string | undefined>,
  values: Record<string, string>,
  prefix: string,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(shell)) {
    if (v !== undefined && !(k in values)) env[k] = v;
  }
  env["STACK_PREFIX"] = prefix;
  return env;
}

export type Stack = {
  envFile: string;
  values: Record<string, string>;
  prefix: string;
  /** `<prefix>-` or empty: the docker namespace of container names. */
  namePrefix: string;
  compose: (...args: string[]) => ReturnType<typeof $>;
  /** Like compose, with extra variables in the compose process only (a secret
   * passed to `exec -e NAME` this way never appears in an argument list). */
  composeWith: (
    extra: Record<string, string>,
    ...args: string[]
  ) => ReturnType<typeof $>;
};

/**
 * Loads the stack named by `--env` (default deploy/.env) and `--prefix`. The compose process gets the file's values
 * and loses any shell export of the same names, so a stale export in a profile
 * cannot decide what a container receives.
 */
export async function loadStack(args: string[]): Promise<Stack> {
  const envFile = resolve(flagValue(args, "--env") ?? `${DEPLOY_DIR}/.env`);
  checkEnvFile(envFile);
  const values = parseEnv(await Bun.file(envFile).text());
  let prefix: string;
  try {
    prefix = resolvePrefix(flagValue(args, "--prefix"), values["STACK_PREFIX"]);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  const env = composeEnv(process.env, values, prefix);
  const files = ["-f", `${DEPLOY_DIR}/docker-compose.yaml`];
  return {
    envFile,
    values,
    prefix,
    namePrefix: prefix ? `${prefix}-` : "",
    compose: (...rest) =>
      $`docker compose ${files} --env-file ${envFile} ${rest}`
        .cwd(DEPLOY_DIR)
        .env(env),
    composeWith: (extra, ...rest) =>
      $`docker compose ${files} --env-file ${envFile} ${rest}`
        .cwd(DEPLOY_DIR)
        .env({ ...env, ...extra }),
  };
}

/** The UI checkout the image is built from, as an absolute path. */
export function uiContext(values: Record<string, string>): string {
  const ctx = values["UI_CONTEXT"] ?? "../../storix-ui";
  return isAbsolute(ctx) ? ctx : resolve(DEPLOY_DIR, ctx);
}

/**
 * The root URI of the stack's Mongo, for the restore and the drill (run inside
 * the backup container). No database in the path: mongorestore reads one there
 * as `--db`, which `--nsInclude` refuses.
 */
export function mongoRootUri(namePrefix: string, rootPassword: string): string {
  return `mongodb://root:${rootPassword}@${namePrefix}storix-mongo:27017/?replicaSet=rs0&authSource=admin`;
}
