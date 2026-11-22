import type { NodesMongo } from "../models";

// The transaction's session, for the driver calls that take it as an option.
export const sessionOf = (tx: NodesMongo) => {
  const session = tx.db.nodes.session;
  return session ? { session } : {};
};
