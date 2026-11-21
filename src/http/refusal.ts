import { HttpError } from "@softistx/alxia";
import type { GraphQLError } from "graphql";

// A refusal outside /graphql (a middleware's), thrown as the HTTP error alxia
// answers, its body in the shape /graphql answers with:
// `{ errors: [{ message, extensions: { code, params? } }] }`, with the status
// the error carries.
export function refusalError(error: GraphQLError): HttpError {
  const { http, ...extensions } = error.extensions as {
    http?: { status?: number };
  } & Record<string, unknown>;
  return new HttpError(http?.status ?? 400, {
    errors: [{ message: error.message, extensions }],
  });
}
