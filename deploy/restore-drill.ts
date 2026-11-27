#!/usr/bin/env bun
/**
 * A restore drill: proves the latest dump restores, without touching the live
 * databases. It restores the dump's core database and every workspace's into
 * scratch databases (`drill_<ts>_core`, `drill_<ts>_ws_<id>`; refused if they
 * could name a live one), lists each database's collections with their document
 * counts, checks that every collection the code defines is present, prints PASS or FAIL,
 * and drops the scratch databases whatever happens. Exits 1 on FAIL. It
 * never stops api and needs no --confirm: nothing live is replaced.
 *
 *   bun deploy/restore-drill.ts [--env deploy/.env] [--prefix demo]
 *                               [--file mongo-<ts>.tar | latest]
 *
 * Needs `bun install` on the host once (it imports the code's collection
 * lists). The expected collections come from the code: the modules' core collections plus
 * janus's for the core database, the modules' workspace collections for each
 * workspace (src/modules/registry.ts, the one list).
 */

import { collectionsOf, coreCollectionsOf } from "@softistx/alxia-modules";
import { janusCollections } from "@softistx/janus-mongo";
import { modules } from "../src/modules/registry";
import {
  assertScratch,
  compareDatabases,
  parseDrillOutput,
  scratchPrefix,
  summarize,
} from "./drill";
import { fail, flagValue, loadStack, mongoRootUri } from "./lib";
import { drillScript } from "./restore-script";

const args = Bun.argv.slice(2);
const known = new Set(["--env", "--prefix", "--file"]);
for (const a of args) {
  if (a.startsWith("--") && !known.has(a)) fail(`unknown flag ${a}`);
}

const stack = await loadStack(args);
const v = stack.values;
const root =
  v["MONGO_ROOT_PASSWORD"] ??
  fail("MONGO_ROOT_PASSWORD is missing from the env file");
const core = v["MONGO_CORE_DATABASE"] || "storix_core";
const orgPrefix = v["MONGO_WORKSPACE_PREFIX"] || "storix_ws_";
const file = flagValue(args, "--file") ?? "latest";
if (file !== "latest" && !/^mongo-[0-9TZ]+\.tar$/.test(file))
  fail(`unexpected dump name ${file}`);

const scratch = scratchPrefix(new Date());
try {
  assertScratch(scratch, core, orgPrefix);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const names = (c: object): string[] =>
  Object.values(c).map((x: { name: string }) => x.name);
const expectedCore = [
  ...names(coreCollectionsOf(modules)),
  ...janusCollections.map((c) => c.name),
];
const expectedWorkspace = names(collectionsOf(modules));
const rootUri = mongoRootUri(stack.namePrefix, root);
console.log(
  `drill: stack ${stack.prefix === "" ? "default" : stack.prefix}, live databases ${core} and ${orgPrefix}* (untouched), scratch ${scratch}*`,
);

// The program is restore-script.ts (drillScript); the scratch databases are dropped on exit.
const script = drillScript;

const out = await stack
  .composeWith(
    { RESTORE_URI: rootUri },
    "exec",
    "-T",
    "-e",
    "RESTORE_URI",
    "-e",
    `CORE=${core}`,
    "-e",
    `ORG_PREFIX=${orgPrefix}`,
    "-e",
    `SCRATCH=${scratch}`,
    "-e",
    `DUMP=${file}`,
    "backup",
    "sh",
    "-c",
    script,
  )
  .text();

const { dump, restored } = parseDrillOutput(out);
const result = compareDatabases(expectedCore, expectedWorkspace, restored);
console.log(summarize(dump, result));
process.exit(result.ok ? 0 : 1);
