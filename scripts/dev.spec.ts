import { expect, test } from "bun:test";
import pkg from "../package.json" with { type: "json" };

// The compose file and `services:up` name the same four long-running services.
test("services:up starts the services docker-compose.yml declares", async () => {
  const compose = await Bun.file(
    `${import.meta.dir}/../docker-compose.yml`,
  ).text();
  for (const service of ["mongo", "redis", "mailpit", "seaweedfs"]) {
    expect(compose).toContain(`\n  ${service}:`);
    expect(pkg.scripts["services:up"]).toContain(service);
  }
});
