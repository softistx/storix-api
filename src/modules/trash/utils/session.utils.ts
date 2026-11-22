import type { FilesMongo } from "@/modules/files/public";

// The transaction's session, for the driver calls that take it as an option.
export const inSession = (tx: FilesMongo) => {
  const session = tx.db.nodes.session;
  return session ? { session } : {};
};
