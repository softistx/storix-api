import { describe, expect, test } from "bun:test";
import { secondSession, standing } from "./identity.account-security.harness";
import { harness } from "./identity.harness";
import { FRESH_FOR_MS } from "./identity.port";
import { codeOf, refusal } from "./identity.refusals";

describe("sessions", () => {
  test("lists the account's standing sessions, the current one marked, newest first", async () => {
    const h = await harness();
    const user = await h.account();
    h.clock.advance(1000);
    const other = await secondSession(h, user.email, "Firefox on Linux");
    const list = await h.identity.sessions(user.principal);
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.current)).toEqual([false, true]);
    expect(list[0]?.id).toBe(other.principal.sessionId as string);
    expect(list[0]?.device).toBe("Firefox on Linux");
    expect(list[1]?.id).toBe(user.principal.sessionId as string);
    expect(list[1]?.device).toBeNull();
    expect(JSON.stringify(list)).not.toContain(other.token);
  });

  test("never lists another account's sessions", async () => {
    const h = await harness();
    const ada = await h.account();
    const eve = await h.account(h.email(), "Eve");
    const list = await h.identity.sessions(ada.principal);
    expect(list.map((s) => s.id)).toEqual([ada.principal.sessionId as string]);
    expect(list.map((s) => s.id)).not.toContain(
      eve.principal.sessionId as string,
    );
  });
});

describe("revokeSession", () => {
  test("ends one of the account's other sessions", async () => {
    const h = await harness();
    const user = await h.account();
    const other = await secondSession(h, user.email);
    expect(
      await h.identity.revokeSession(
        user.principal,
        other.principal.sessionId as string,
      ),
    ).toBe(true);
    expect(await standing(h, other.token)).toBeNull();
    expect(await standing(h, user.token)).not.toBeNull();
  });

  test("another account's session is a 404 and stays standing", async () => {
    const h = await harness();
    const ada = await h.account();
    const eve = await h.account(h.email(), "Eve");
    const error = await refusal(
      h.identity.revokeSession(
        ada.principal,
        eve.principal.sessionId as string,
      ),
    );
    expect(codeOf(error)).toBe("identity.errors.session-not-found");
    expect(error.extensions["http"]).toEqual({ status: 404 });
    expect(await standing(h, eve.token)).not.toBeNull();
  });

  test("an unknown id and an already revoked session are 404 too", async () => {
    const h = await harness();
    const user = await h.account();
    const other = await secondSession(h, user.email);
    const id = other.principal.sessionId as string;
    await h.identity.revokeSession(user.principal, id);
    expect(
      codeOf(await refusal(h.identity.revokeSession(user.principal, id))),
    ).toBe("identity.errors.session-not-found");
    expect(
      codeOf(await refusal(h.identity.revokeSession(user.principal, "nope"))),
    ).toBe("identity.errors.session-not-found");
  });

  test("needs a fresh session", async () => {
    const h = await harness();
    const user = await h.account();
    const other = await secondSession(h, user.email);
    h.clock.advance(FRESH_FOR_MS + 1000);
    expect(
      codeOf(
        await refusal(
          h.identity.revokeSession(
            user.principal,
            other.principal.sessionId as string,
          ),
        ),
      ),
    ).toBe("auth.errors.step-up-required");
    expect(await standing(h, other.token)).not.toBeNull();
  });
});

describe("revokeOtherSessions", () => {
  test("ends every other session, keeps the current one, and counts them", async () => {
    const h = await harness();
    const user = await h.account();
    const second = await secondSession(h, user.email);
    const third = await secondSession(h, user.email, "Safari on iPhone");
    const eve = await h.account(h.email(), "Eve");
    expect(await h.identity.revokeOtherSessions(user.principal)).toBe(2);
    expect(await standing(h, user.token)).not.toBeNull();
    expect(await standing(h, second.token)).toBeNull();
    expect(await standing(h, third.token)).toBeNull();
    // Another account's session is not touched.
    expect(await standing(h, eve.token)).not.toBeNull();
    expect(await h.identity.sessions(user.principal)).toHaveLength(1);
  });

  test("needs a fresh session and ends nothing without one", async () => {
    const h = await harness();
    const user = await h.account();
    const other = await secondSession(h, user.email);
    h.clock.advance(FRESH_FOR_MS + 1000);
    expect(
      codeOf(await refusal(h.identity.revokeOtherSessions(user.principal))),
    ).toBe("auth.errors.step-up-required");
    expect(await standing(h, other.token)).not.toBeNull();
  });

  test("an API key is refused", async () => {
    const h = await harness();
    const user = await h.account();
    const key = {
      ...user.principal,
      authenticatedAt: null,
      sessionId: null,
      apiKeyId: "key",
    };
    expect(codeOf(await refusal(h.identity.revokeOtherSessions(key)))).toBe(
      "auth.errors.step-up-required",
    );
  });
});
