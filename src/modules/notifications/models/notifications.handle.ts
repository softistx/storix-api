import type { ModuleCoreHandle } from "@softistx/alxia-modules";
import type { core } from "@/config/db";

// The module's handle on the core database: its own collections only.
export type NotificationsMongo = ModuleCoreHandle<"notifications", typeof core>;

export type NotificationDoc = Awaited<
  ReturnType<NotificationsMongo["db"]["notifications"]["getById"]>
>;

// The one place the core database becomes the module's typed handle (a scope's
// `core` is a plain record to the compiler: src/core/access/ports.ts).
export const notificationsMongo = (core: unknown): NotificationsMongo =>
  core as NotificationsMongo;
