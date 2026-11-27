import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The compose file and the Dockerfile are read as text and as YAML: what the
// slice promises (routing, proxies, Redis, no published port) is pinned here
// without Docker. CI does not run Docker: the image build (with its PDF check) and `docker compose config` are run locally for the PR.
const dir = import.meta.dir;
// Compose interpolation, written without a template-looking string.
const v = (expr: string) => ["$", "{", expr, "}"].join("");
const composeText = readFileSync(join(dir, "docker-compose.yaml"), "utf8");
const compose = Bun.YAML.parse(composeText) as {
  services: Record<
    string,
    {
      ports?: unknown;
      profiles?: string[];
      depends_on?: Record<string, { condition: string }>;
      environment?: Record<string, string>;
      volumes?: {
        type: string;
        source: string;
        target: string;
        read_only?: boolean;
        bind?: { create_host_path?: boolean };
      }[];
      labels?: string[];
      networks?: string[];
      deploy?: { resources?: { limits?: { cpus?: string; memory?: string } } };
      healthcheck?: {
        test?: string[];
        interval?: string;
        start_interval?: string;
      };
    }
  >;
  networks: Record<string, { external?: boolean }>;
};
const apiEnv = (compose.services["api"]?.environment ?? {}) as Record<
  string,
  string
>;

describe("docker-compose.yaml", () => {
  test("no service publishes a port", () => {
    for (const [name, service] of Object.entries(compose.services))
      expect(service.ports, `${name} publishes a port`).toBeUndefined();
  });

  test("the data services are on the stack network only; only api and ui join the external proxy network", () => {
    expect(compose.networks["proxy"]?.external).toBe(true);
    expect(compose.networks["internal"]?.external).toBeUndefined();
    for (const [name, service] of Object.entries(compose.services)) {
      const expected =
        name === "api" || name === "ui" ? ["internal", "proxy"] : ["internal"];
      expect([...(service.networks ?? [])].sort(), name).toEqual(expected);
    }
  });

  test("the stack is mongo, redis, seaweedfs, their init one-shots, api, worker, jobs, migrate and the opt-in backup and ui", () => {
    expect(Object.keys(compose.services).sort()).toEqual([
      "api",
      "backup",
      "jobs",
      "migrate",
      "mongo",
      "mongo-init",
      "redis",
      "s3-init",
      "seaweedfs",
      "ui",
      "worker",
    ]);
    expect(compose.services["ui"]?.profiles).toEqual(["ui"]);
    expect(compose.services["migrate"]?.profiles).toEqual(["ops"]);
  });

  test("migrate runs db:sync then db:migrate from the bundled scripts, and the worker and jobs wait for it only when it runs", () => {
    const command = JSON.stringify(compose.services["migrate"]?.command);
    expect(command.indexOf("dist/scripts/db-sync.js")).toBeGreaterThan(-1);
    expect(command.indexOf("dist/scripts/db-migrate.js")).toBeGreaterThan(
      command.indexOf("dist/scripts/db-sync.js"),
    );
    for (const name of ["worker", "jobs"]) {
      const dep = compose.services[name]?.depends_on?.["migrate"] as
        | { condition: string; required?: boolean }
        | undefined;
      expect(dep?.condition, name).toBe("service_completed_successfully");
      expect(dep?.required, name).toBe(false);
    }
  });

  test("the worker runs dist/worker.js and the jobs service the scheduler, both from the API's image", () => {
    expect(compose.services["worker"]?.command).toEqual([
      "bun",
      "--no-install",
      "dist/worker.js",
    ]);
    expect(compose.services["jobs"]?.entrypoint).toEqual([
      "bash",
      "/jobs/jobs-loop",
    ]);
    for (const name of ["worker", "jobs", "migrate"])
      expect(compose.services[name]?.image, name).toBe(
        compose.services["api"]?.image,
      );
  });

  test("the long-running bun and mongo services run under an init that reaps zombies", () => {
    for (const name of ["api", "worker", "jobs", "mongo", "backup"])
      expect(compose.services[name]?.init).toBe(true);
  });

  test("the backup service is opt-in: profile backup, the only service that reads BACKUP_S3_*, never required by compose itself", () => {
    expect(compose.services["backup"]?.profiles).toEqual(["backup"]);
    for (const [name, service] of Object.entries(compose.services))
      if (name !== "backup")
        expect(JSON.stringify(service)).not.toContain("BACKUP_S3");
    // Compose interpolates disabled profiles too: a `:?` here would block a stack without the backup.
    expect(composeText).not.toMatch(
      /\$\{(BACKUP_S3_\w+|MONGO_BACKUP_PASSWORD):\?\}/,
    );
    // mongo-init creates the backup user only when a password is given.
    expect(
      compose.services["mongo-init"]?.environment?.["BACKUP_PASSWORD"],
    ).toBe(v("MONGO_BACKUP_PASSWORD:-"));
    expect(JSON.stringify(compose.services["mongo-init"]?.command)).toContain(
      "if (process.env.BACKUP_PASSWORD)",
    );
  });

  test("the API, the worker and the jobs wait for a healthy Redis (the rate limits and the queues live in it) and gets REDIS_URL", () => {
    for (const name of ["api", "worker", "jobs"])
      expect(compose.services[name]?.depends_on?.["redis"]?.condition).toBe(
        "service_healthy",
      );
    expect(apiEnv["REDIS_URL"]).toMatch(/^redis:\/\/:\$\{REDIS_PASSWORD:\?\}@/);
  });

  test("the API trusts the docker range as proxies, never a hop count or a vendor keyword", () => {
    expect(apiEnv["TRUSTED_PROXIES"]).toBe(v("TRUSTED_PROXIES:-172.16.0.0/12"));
    expect(composeText).not.toMatch(/CF-Connecting-IP|X-Real-Ip/i);
  });

  test("API_PROXY_SECRET is required and the same variable on the api and the ui", () => {
    expect(apiEnv["API_PROXY_SECRET"]).toBe(v("API_PROXY_SECRET:?"));
    expect(compose.services["ui"]?.environment?.["API_PROXY_SECRET"]).toBe(
      v("API_PROXY_SECRET:?"),
    );
  });

  test("production settings: https origin, required TOTP keys, auto sync for the per-workspace databases", () => {
    expect(apiEnv["NODE_ENV"]).toBe("production");
    expect(apiEnv["UI_ORIGIN"]).toContain(v("UI_HOSTNAME:?"));
    expect(apiEnv["TOTP_KEYS"]).toBe(v("TOTP_KEYS:?"));
    expect(apiEnv["AUDIT_IP_KEY"]).toBe(v("AUDIT_IP_KEY:?"));
    expect(apiEnv["MONGO_AUTO_SYNC"]).toBe("true");
  });

  test("only /public/ is routed to the API, on the one hostname, above the UI", () => {
    const labels = compose.services["api"]?.labels ?? [];
    expect(labels).toContain("traefik.enable=true");
    const rule = labels.find((l) => l.includes(".rule="));
    expect(rule).toContain(
      `Host(\`${v("UI_HOSTNAME:?")}\`) && PathPrefix(\`/public/\`)`,
    );
    expect(labels.some((l) => l.endsWith(".priority=100"))).toBe(true);
    expect(
      labels.some((l) => l.includes("loadbalancer.server.port=3000")),
    ).toBe(true);
    // The data services are never routed.
    for (const name of [
      "mongo",
      "redis",
      "seaweedfs",
      "backup",
      "worker",
      "jobs",
      "migrate",
    ])
      expect(compose.services[name]?.labels).toContain("traefik.enable=false");
  });

  test("the UI serves the widget's dist: WIDGET_DIST_DIR set, the dist mounted read only and never created empty", () => {
    const ui = compose.services["ui"];
    expect(ui?.environment?.["WIDGET_DIST_DIR"]).toBe("/widget");
    expect(ui?.volumes).toEqual([
      {
        type: "bind",
        source: v("WIDGET_DIST:-../../storix-widget/dist"),
        target: "/widget",
        read_only: true,
        bind: { create_host_path: false },
      },
    ]);
    // The API serves no widget file.
    expect(apiEnv["WIDGET_DIST_DIR"]).toBeUndefined();
  });

  test("no DNS record is part of the stack", () => {
    expect(composeText).not.toMatch(/cloudflare.*(record|zone)|dns_record/i);
  });
});

// The owner's rule of 2026-11-18 (the host capped the VPS CPU): every container is capped,
// and a healthcheck is cheap and rare. Both compose files are held to it.
const localText = readFileSync(join(dir, "..", "docker-compose.yml"), "utf8");
const local = Bun.YAML.parse(localText) as Pick<typeof compose, "services">;
const seconds = (d: string) => {
  const m = /^(\d+)(ms|s|m|h)$/.exec(d);
  if (!m) throw new Error(`unreadable duration ${d}`);
  const n = Number(m[1]);
  return m[2] === "ms" ? n / 1000 : n * { s: 1, m: 60, h: 3600 }[m[2] as "s"];
};

describe.each([
  ["deploy/docker-compose.yaml", compose.services],
  ["docker-compose.yml", local.services],
])("%s resources and healthchecks", (_file, services) => {
  test("every service has cpu and memory limits", () => {
    for (const [name, service] of Object.entries(services)) {
      const limits = service.deploy?.resources?.limits;
      expect(Number(limits?.cpus), `${name} cpus`).toBeGreaterThan(0);
      expect(Number(limits?.cpus), `${name} cpus`).toBeLessThanOrEqual(1);
      expect(limits?.memory, `${name} memory`).toMatch(/^\d+[MG]$/);
    }
  });

  test("a healthcheck runs every 30 s or more, and never spawns mongosh or bun", () => {
    for (const [name, service] of Object.entries(services)) {
      const hc = service.healthcheck;
      if (!hc) continue;
      expect(
        seconds(hc.interval ?? "30s"),
        `${name} interval`,
      ).toBeGreaterThanOrEqual(30);
      if (hc.start_interval)
        expect(
          seconds(hc.start_interval),
          `${name} start_interval`,
        ).toBeGreaterThanOrEqual(1);
      const test = JSON.stringify(hc.test);
      expect(test, name).not.toMatch(/mongosh|\bbun\b|\bnode\b/);
    }
  });
});

describe("limits sized to real use", () => {
  const limit = (name: string) =>
    compose.services[name]?.deploy?.resources?.limits;
  test("the data services, the API, the worker and the UI get the sized caps", () => {
    expect(limit("mongo")).toEqual({ cpus: "1.0", memory: "1G" });
    expect(limit("redis")).toEqual({ cpus: "0.25", memory: "256M" });
    expect(limit("seaweedfs")).toEqual({ cpus: "0.5", memory: "512M" });
    expect(limit("worker")).toEqual({ cpus: "0.5", memory: "512M" });
    expect(limit("api")).toEqual({ cpus: "1.0", memory: "1G" });
    expect(limit("ui")).toEqual({ cpus: "0.5", memory: "512M" });
    expect(limit("backup")).toEqual({ cpus: "0.5", memory: "512M" });
  });

  test("mongo is probed by a bash TCP check; mongo-init initiates the replica set and waits for the primary", () => {
    expect(
      JSON.stringify(compose.services["mongo"]?.healthcheck?.test),
    ).toContain("/dev/tcp/127.0.0.1/27017");
    const init = JSON.stringify(compose.services["mongo-init"]?.command);
    expect(init).toContain("replSetInitiate");
    expect(init).toContain("isWritablePrimary");
  });

  test("seaweedfs is probed with wget, the files bucket is created by s3-init and the app identity is limited to it", () => {
    expect(compose.services["seaweedfs"]?.healthcheck?.test).toContain("wget");
    expect(JSON.stringify(compose.services["s3-init"]?.command)).toContain(
      "mc mb --ignore-existing",
    );
    const entry = JSON.stringify(compose.services["seaweedfs"]?.entrypoint);
    expect(entry).toContain("Read:$$BUCKET");
    expect(entry).not.toMatch(/Admin.*Read:\$\$BUCKET.*Admin/);
    for (const name of ["api", "worker", "jobs", "migrate"])
      expect(
        compose.services[name]?.environment?.["S3_ENDPOINT"],
        name,
      ).toContain("storix-seaweedfs:8333");
  });

  test("jobs reports a heartbeat, not a process check; the worker has no healthcheck", () => {
    expect(
      JSON.stringify(compose.services["jobs"]?.healthcheck?.test),
    ).toContain("/tmp/jobs-alive");
    expect(compose.services["worker"]?.healthcheck).toBeUndefined();
  });

  test("redis and the UI use redis-cli and wget, the API a bash socket", () => {
    expect(
      JSON.stringify(compose.services["redis"]?.healthcheck?.test),
    ).toContain("redis-cli ping");
    expect(compose.services["ui"]?.healthcheck?.test).toContain("wget");
    expect(
      JSON.stringify(compose.services["api"]?.healthcheck?.test),
    ).toContain("/dev/tcp/127.0.0.1/3000");
  });
});

describe("Dockerfile", () => {
  const dockerfile = readFileSync(join(dir, "..", "Dockerfile"), "utf8");

  test("Bun is pinned to the version CI uses", () => {
    const ci = readFileSync(
      join(dir, "..", ".github", "workflows", "ci.yml"),
      "utf8",
    );
    const bun = /bun-version:\s*(\S+)/.exec(ci)?.[1];
    expect(bun).toBeDefined();
    expect(dockerfile).toContain(`FROM oven/bun:${bun} AS build`);
    expect(dockerfile).toContain(`FROM oven/bun:${bun}-slim`);
  });

  test("the image holds dist only, runs as bun and starts the server", () => {
    expect(dockerfile).toContain("COPY --from=build /app/dist ./dist");
    expect(dockerfile).toContain("USER bun");
    expect(dockerfile).toContain(
      'CMD ["bun", "--no-install", "dist/server.js"]',
    );
  });

  test("the build bundles the server, the worker and the scripts the stack runs", () => {
    const pkg = JSON.parse(
      readFileSync(join(dir, "..", "package.json"), "utf8"),
    );
    for (const entry of [
      "src/server.ts",
      "src/worker.ts",
      "src/scripts/db-sync.ts",
      "src/scripts/db-migrate.ts",
      "src/scripts/storage-sweep.ts",
      "src/scripts/retention.ts",
      "src/scripts/quota-reconcile.ts",
    ])
      expect(pkg.scripts.build, entry).toContain(entry);
    expect(pkg.scripts.build).toContain("--outdir=dist");
  });

  test("every script the jobs loop and migrate run is one the build bundles", () => {
    const loop = readFileSync(join(dir, "jobs", "jobs-loop"), "utf8");
    const pkg = JSON.parse(
      readFileSync(join(dir, "..", "package.json"), "utf8"),
    );
    for (const name of ["storage-sweep", "retention", "quota-reconcile"]) {
      expect(loop).toContain(name);
      expect(pkg.scripts.build).toContain(`src/scripts/${name}.ts`);
    }
  });
});

describe("ci.yml", () => {
  const ci = readFileSync(
    join(dir, "..", ".github", "workflows", "ci.yml"),
    "utf8",
  );

  test("stays one job", () => {
    const jobs = ci.slice(ci.indexOf("\njobs:"));
    expect(jobs.match(/^ {2}[a-z][\w-]*:\s*$/gm)).toEqual(["  verify:"]);
  });
});
