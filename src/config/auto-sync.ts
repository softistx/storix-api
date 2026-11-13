/**
 * Whether a collection's validators and indexes are created on its first use:
 * always outside production, and in production only when MONGO_AUTO_SYNC is on
 * (src/config/env.ts; deploy/ sets it, the app user holds the dbAdmin role).
 */
export const autoSyncOf = (production: boolean, flag: boolean): boolean =>
  !production || flag;
