import { expect } from "bun:test";
import { totpCode } from "@softistx/janus/testing";
import { harness } from "./identity.harness";

export const STEP = 31_000;
export const FRESH = 10 * 60 * 1000;

// An account with an active second factor: its secret, recovery codes and the
// session that activated it.
export async function withSecondFactor() {
  const h = await harness();
  const user = await h.account();
  const { secret, uri } = await h.identity.enrolSecondFactor(user.principal);
  expect(uri.startsWith("otpauth://")).toBe(true);
  const { recoveryCodes } = await h.identity.activateSecondFactor(
    user.principal,
    totpCode(secret, h.clock.now()),
  );
  const bearer = (token: string) =>
    new Request("http://localhost/", {
      headers: { authorization: `Bearer ${token}` },
    });
  return { h, user, secret, recoveryCodes, bearer };
}
