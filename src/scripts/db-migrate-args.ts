import type { MigrateMode } from "@softistx/alxia-tenancy";

// The `db:migrate` flags as a mode: `--rollback-to <id>` (or
// `--rollback-to=<id>`) undoes everything after <id> (with `--dry-run` to
// preview it), `--status` prints the states only, no flag applies what is
// pending (`--dry-run` lists it without writing). A rollback wins over
// `--status`. Throws on any other argument (a mistyped flag must never fall
// through to a real apply) and when `--rollback-to` has no id (missing, empty,
// or followed by another flag).
export function parseMode(args: readonly string[]): MigrateMode {
  let dryRun = false;
  let status = false;
  let to: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--status") status = true;
    else if (arg === "--rollback-to" || arg.startsWith("--rollback-to=")) {
      const eq = arg.startsWith("--rollback-to=");
      const id = eq ? arg.slice("--rollback-to=".length) : args[++i];
      if (id === undefined || id === "" || id.startsWith("--")) {
        throw new Error("--rollback-to needs an id");
      }
      to = id;
    } else throw new Error(`unknown argument "${arg}"`);
  }
  if (to !== undefined) return { kind: "rollback", to, dryRun };
  if (status) return { kind: "status" };
  return { kind: "apply", dryRun };
}
