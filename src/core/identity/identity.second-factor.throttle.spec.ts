import { expect, test } from "bun:test";
import { totpCode } from "@softistx/janus/testing";
import { harness } from "./identity.harness";

// janus 0.68 limits the second-factor codes tried per account (a window of
// wrong codes). Past it the API answers 429 `auth.errors.rate-limited` with `extensions.retryAfter`, never `second-factor-invalid`.
test("past the per-account second-factor throttle, a code is refused 429 with retryAfter", async () => {
  const h = await harness();
  const user = await h.account();
  const { secret } = await h.identity.enrolSecondFactor(user.principal);
  await h.identity.activateSecondFactor(
    user.principal,
    totpCode(secret, h.clock.now()),
  );
  const principal = { ...user.principal, secondFactor: true };
  const request = new Request("http://localhost/", {
    headers: { authorization: `Bearer ${user.token}` },
  });
  let last: { extensions: Record<string, unknown> } | undefined;
  for (let i = 0; i < 15; i++) {
    try {
      await h.identity.disableSecondFactor(request, principal, "WRONG-0");
    } catch (error) {
      last = error as { extensions: Record<string, unknown> };
      if (last.extensions["code"] === "auth.errors.rate-limited") break;
    }
  }
  expect(last?.extensions["code"]).toBe("auth.errors.rate-limited");
  expect(typeof last?.extensions["retryAfter"]).toBe("number");
});
