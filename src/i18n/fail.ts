import { invalidInputError, type Translate } from "@nxgt/graphql-validation";
import { GraphQLError, type GraphQLErrorOptions } from "graphql";
import type { ErrorCode } from "./codes";
import { i18n } from "./index";
import type { Params } from "./params";

// A refused operation: `extensions.code` is the error code, stable, which
// clients map to their own translation; `message` is that code translated in
// the request's language, their fallback; `extensions.params`, when given, are
// the values that message interpolates ({minutes}…), so a client can word the
// refusal itself; `extensions.http.status`, when given, is the HTTP status
// Yoga answers a top-level failure with; `extensions.field`, when given, names
// the input field it is about. `/media` and `/public` refusals use the same
// shape (plan §3.13).
export function fail(
  code: ErrorCode,
  options: { params?: Params; status?: number; field?: string } = {},
): GraphQLError {
  return new GraphQLError(i18n.t(code, options.params), {
    extensions: {
      code,
      ...(options.params && { params: options.params }),
      ...(options.status && { http: { status: options.status } }),
      ...(options.field && { field: options.field }),
    },
  });
}

export const unauthenticated = () =>
  fail("auth.errors.unauthenticated", { status: 401 });

export const forbidden = () => fail("auth.errors.forbidden", { status: 403 });

// One refused field of an input: `path` is relative to the input
// ("name", "person.firstName"), `code` an error code, `params` the values its
// message interpolates, passed on to clients.
export interface FieldIssue {
  path: string;
  code: ErrorCode;
  params?: Params;
}

export const translate: Translate = (code, params) =>
  i18n.t(code as ErrorCode, params as Params | undefined);

// An input refused as a whole, with every field that refused it: one error
// whatever the module, `validation.errors.invalid-input`, status 400, and
// `extensions.fields: [{ path, code, message, params? }]`, each message
// translated (@nxgt/graphql-validation's `invalidInputError`).
export const invalidInput = (
  issues: FieldIssue[],
  options: GraphQLErrorOptions = {},
): GraphQLError => invalidInputError(issues, { ...options, translate });
