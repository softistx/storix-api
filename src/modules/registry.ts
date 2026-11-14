import { type Module, resolveModules } from "@alxia/modules";
import type { Migration } from "@softistx/mongo/migrations";
import { system } from "../core/system/module";
import { translationsModule } from "../core/translations/module";

// THE list of modules: adding one is one line here. Dependency order is
// computed (`resolveModules`), not written. Each module of the plan's §3.2 is
// added by the slice that builds it.
const registered = [system, translationsModule] as const;

export const modules: readonly Module[] = resolveModules(registered);

// The registered manifests with their own types, for the typed handles of the
// databases (`CollectionsOf`, `ModuleHandle`; src/config/db.ts).
declare module "@alxia/modules" {
  interface Register {
    modules: typeof registered;
    migration: Migration;
  }
}
