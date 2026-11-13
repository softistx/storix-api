// `bun run dev`: the local stack in one command.
//   1. starts the Docker services (docker-compose.yml) and waits until they are healthy;
//   2. runs the API in watch mode (`bun run dev:api`) until Ctrl+C.
// The services keep running on exit; `bun run services:down` stops them.
// db:sync, db:migrate and the demo seed join the sequence with the slices that add them.
import type { Subprocess } from "bun";

const root = new URL("..", import.meta.url).pathname;
let child: Subprocess | undefined;
let signalled = 0;

for (const [name, number] of [
  ["SIGINT", 2],
  ["SIGTERM", 15],
] as const) {
  process.on(name, () => {
    signalled = number;
    child?.kill(number);
  });
}

/** Runs a package script to its end; a signal received meanwhile exits 128 + its number. */
async function script(name: string): Promise<number> {
  if (signalled) process.exit(128 + signalled);
  child = Bun.spawn(["bun", "run", name], {
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  child = undefined;
  if (signalled) process.exit(128 + signalled);
  return code;
}

if (import.meta.main) {
  if ((await script("services:up")) !== 0) {
    console.error(
      "dev: the Docker services did not start (is Docker running?)",
    );
    process.exit(1);
  }
  process.exit(await script("dev:api"));
}
