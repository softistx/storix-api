/**
 * The argument and settings checks of restore.ts, as a pure function so every
 * guard can be tested without Docker: the destructive flags, the stack named by
 * --confirm, the dump name, the offsite prefix, the database names.
 */

import { prefixProblem } from "./backup";

export const RESTORE_FLAGS = new Set([
  "--env",
  "--prefix",
  "--file",
  "--offsite",
  "--media",
  "--from-prefix",
  "--database",
  "--yes",
  "--confirm",
]);

export type RestoreOptions = {
  /** `default` for an unprefixed stack, else the STACK_PREFIX. */
  target: string;
  core: string;
  orgPrefix: string;
  file: string;
  fromOffsite: boolean;
  fromPrefix: string;
  /** One database to restore (the core one or an workspace's), empty for all. */
  database: string;
  media: boolean;
};

export type RestoreContext = {
  /** The stack's STACK_PREFIX, empty when none. */
  stackPrefix: string;
  /** The env file's values. */
  values: Record<string, string>;
};

const flagArg = (args: string[], name: string): string | undefined | Error => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  return v === undefined || v.startsWith("--")
    ? new Error(`${name} needs a value`)
    : v;
};

/** The options, or the error to print. Never exits. */
export function restoreOptions(
  args: string[],
  ctx: RestoreContext,
): RestoreOptions | Error {
  for (const a of args)
    if (a.startsWith("--") && !RESTORE_FLAGS.has(a))
      return new Error(`unknown flag ${a}`);
  if (!args.includes("--yes"))
    return new Error(
      "this drops the collections it restores: rerun with --yes --confirm <prefix|default>",
    );
  const target = ctx.stackPrefix === "" ? "default" : ctx.stackPrefix;
  const confirm = flagArg(args, "--confirm");
  if (confirm instanceof Error) return confirm;
  if (confirm !== target)
    return new Error(
      `--confirm must match the stack being restored: --confirm ${target} (got ${confirm ?? "nothing"})`,
    );
  // `||`, not `??`: an empty value in the env file means the default, and an
  // empty prefix would match every database of the instance.
  const core = ctx.values["MONGO_CORE_DATABASE"] || "storix_core";
  const orgPrefix = ctx.values["MONGO_WORKSPACE_PREFIX"] || "storix_ws_";
  if (!/^[A-Za-z0-9_-]+$/.test(core))
    return new Error(`unexpected MONGO_CORE_DATABASE ${core}`);
  if (!/^[A-Za-z0-9_-]+$/.test(orgPrefix))
    return new Error(`unexpected MONGO_WORKSPACE_PREFIX ${orgPrefix}`);
  const fromPrefix = flagArg(args, "--from-prefix");
  if (fromPrefix instanceof Error) return fromPrefix;
  if (fromPrefix !== undefined) {
    const problem = prefixProblem(fromPrefix);
    if (problem) return new Error(`--from-prefix ${problem}`);
  }
  const file = flagArg(args, "--file");
  if (file instanceof Error) return file;
  const dump = file ?? "latest";
  if (dump !== "latest" && !/^mongo-[0-9TZ]+\.tar$/.test(dump))
    return new Error(`unexpected dump name ${dump}`);
  const database = flagArg(args, "--database");
  if (database instanceof Error) return database;
  if (
    database !== undefined &&
    !(
      /^[A-Za-z0-9_-]+$/.test(database) &&
      (database === core ||
        (database.startsWith(orgPrefix) && database.length > orgPrefix.length))
    )
  )
    return new Error(
      `--database must be ${core} or an workspace database (${orgPrefix}<id>), got ${database}`,
    );
  return {
    target,
    core,
    orgPrefix,
    file: dump,
    fromOffsite: args.includes("--offsite") || fromPrefix !== undefined,
    fromPrefix: fromPrefix ?? "",
    database: database ?? "",
    media: args.includes("--media"),
  };
}
