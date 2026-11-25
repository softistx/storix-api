import type { MigrateMode } from "@softistx/alxia-tenancy";

// The `db:migrate` flags as a mode: `--rollback-to <id>` undoes everything
// after <id> (with `--dry-run` to preview it), `--status` prints the states
// only, anything else applies what is pending (`--dry-run` lists it without
// writing). A rollback wins over `--status`. Throws when `--rollback-to` has
// no id (missing, or followed by another flag).
export function parseMode(args: readonly string[]): MigrateMode {
  const dryRun = args.includes("--dry-run");
  const at = args.indexOf("--rollback-to");
  if (at !== -1) {
    const to = args[at + 1];
    if (to === undefined || to.startsWith("--")) {
      throw new Error("--rollback-to needs an id");
    }
    return { kind: "rollback", to, dryRun };
  }
  if (args.includes("--status")) return { kind: "status" };
  return { kind: "apply", dryRun };
}
