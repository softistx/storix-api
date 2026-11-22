// What janus-graphql answers of an invitation: never the code (that is
// `JanusIssuedInvitation.code`, which this file never reads).
export interface Invitation {
  id: string;
  scope: string;
  email: string;
  name?: string;
  role: string;
}

// `issueInvitation` and `resendInvitation` answer `{ invitation, code }`,
// `revokeInvitation` the invitation itself. Null when the answer is neither:
// the write has committed, so an unreadable answer only means no event.
export const invitationOf = (answer: unknown): Invitation | null => {
  if (typeof answer !== "object" || answer === null) return null;
  const nested = (answer as { invitation?: unknown }).invitation;
  const found = nested ?? answer;
  if (typeof found !== "object" || found === null) return null;
  const { id, scope } = found as Partial<Invitation>;
  return typeof id === "string" && typeof scope === "string"
    ? (found as Invitation)
    : null;
};
