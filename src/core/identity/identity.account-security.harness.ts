import { type harness, PASSWORD } from "./identity.harness";

// A second session of the account, as a sign-in from another device.
export async function secondSession(
  h: Awaited<ReturnType<typeof harness>>,
  email: string,
  deviceLabel = "Firefox on Linux",
) {
  const result = await h.identity.signIn(
    { email, password: PASSWORD },
    { deviceLabel },
  );
  if (result.status !== "SIGNED_IN") throw new Error("not signed in");
  return { token: result.token, principal: result.principal };
}

export const standing = async (
  h: Awaited<ReturnType<typeof harness>>,
  token: string,
) =>
  h.identity.authenticate(
    new Request("http://localhost/graphql", {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
