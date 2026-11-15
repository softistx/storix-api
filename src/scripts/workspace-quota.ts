import { closeDatabases, core } from "../config/db";
import { DEFAULT_QUOTA_BYTES, setQuota } from "../core/workspaces";
import { parseBytes } from "./quota-args";

// A platform step (there is no billing in v1): sets a workspace's storage
// quota, in bytes. Takes effect on the next upload; a workspace already over
// its new quota keeps its files and cannot add more.
//
//   bun run workspace:quota <slug> <bytes>      e.g. 21474836480 or 20GiB
//   bun run workspace:quota <slug> default      back to 10 GiB
const [slug, amount] = Bun.argv.slice(2);
const bytes = amount === "default" ? DEFAULT_QUOTA_BYTES : parseBytes(amount);
if (!slug || bytes === undefined) {
  console.error("usage: bun run workspace:quota <slug> <bytes|20GiB|default>");
  process.exit(2);
}
let found = false;
try {
  found = await setQuota(core, slug, bytes);
} finally {
  await closeDatabases();
}
if (!found) {
  console.error(`no workspace with the slug "${slug}"`);
  process.exit(1);
}
console.log(`quota of "${slug}" set to ${bytes} bytes`);
