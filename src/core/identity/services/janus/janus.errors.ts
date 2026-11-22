import { JanusError, StoreFailure } from "@softistx/janus";
import type { GraphQLError } from "graphql";
import { fail, invalidInput, rateLimited } from "@/i18n/fail";

// janus's errors as the API answers them. A code says what the client can act
// on, never which of janus's reasons it was: an unknown address, a deactivated
// account and a wrong password are one `identity.errors.invalid-credentials`.
export const invalidCredentials = () =>
  fail("identity.errors.invalid-credentials", { status: 401 });

export const unavailable = () =>
  fail("identity.errors.unavailable", { status: 503 });

export const stepUpRequired = () =>
  fail("auth.errors.step-up-required", { status: 403 });

export const currentPasswordWrong = () =>
  fail("identity.errors.current-password-wrong", { status: 400 });

export const sessionNotFound = () =>
  fail("identity.errors.session-not-found", { status: 404 });

export const tooShort = (min: number, path = "password") =>
  invalidInput([
    { path, code: "validation.errors.too-short", params: { min } },
  ]);

// janus's error as the API answers it, or undefined for one it does not
// answer (a wiring mistake, which graxia masks as a 500).
export function fromJanus(error: JanusError): GraphQLError | undefined {
  switch (error.code) {
    case "CREDENTIALS_INVALID":
      return error.retryAfter !== undefined
        ? rateLimited(error.retryAfter)
        : invalidCredentials();
    // Mail requests past the window: nothing was issued, the last link works.
    case "MAIL_THROTTLED":
      return rateLimited(error.retryAfter ?? 1);
    // A wrong code. `attemptsLeft` is the tries the challenge has left; janus's
    // per-account window of app codes refuses with `reason: "throttled"`.
    case "CODE_INVALID": {
      if (error.reason === "throttled" && error.retryAfter !== undefined) {
        return rateLimited(error.retryAfter);
      }
      const invalid = fail("identity.errors.second-factor-invalid", {
        status: 400,
      });
      if (error.attemptsLeft !== undefined) {
        invalid.extensions["attemptsLeft"] = error.attemptsLeft;
      }
      return invalid;
    }
    case "STEP_UP_REQUIRED":
      return stepUpRequired();
    case "SECOND_FACTOR_NOT_ENROLLED":
    case "SECOND_FACTOR_ACTIVE":
      return fail("identity.errors.second-factor-state", { status: 409 });
    case "TOKEN_UNKNOWN":
    case "TOKEN_SPENT":
    case "TOKEN_EXPIRED":
    case "TOKEN_STALE":
    case "VERSION_CONFLICT":
      return fail("identity.errors.token-invalid", { status: 400 });
    case "PASSWORD_TOO_SHORT":
      return tooShort(error.minLength ?? 8);
    case "EMAIL_UNVERIFIED":
      return fail("identity.errors.email-unverified", { status: 403 });
    case "USER_INACTIVE":
    case "NOT_FOUND":
      return fail("auth.errors.forbidden", { status: 403 });
    default:
      return undefined;
  }
}

// Runs a call to janus, its refusals as the API says them. A store that cannot
// answer is 503, never an anonymous or a wrong-credentials answer.
export async function authCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof StoreFailure) throw unavailable();
    if (error instanceof JanusError) throw fromJanus(error) ?? error;
    throw error;
  }
}

// A call on a sign-in path: an unknown or a deactivated account answers as a
// wrong password does, so no answer tells whether the account exists.
export function signInCall<T>(call: () => Promise<T>): Promise<T> {
  return authCall(async () => {
    try {
      return await call();
    } catch (error) {
      if (
        error instanceof JanusError &&
        (error.code === "USER_INACTIVE" || error.code === "NOT_FOUND")
      ) {
        throw invalidCredentials();
      }
      throw error;
    }
  });
}
