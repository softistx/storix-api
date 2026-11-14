import { inputPath } from "@nxgt/graphql-validation";
import { GraphQLError } from "graphql";
import type { Plugin } from "graphql-yoga";
import type { ErrorCode } from "../i18n/codes";
import { invalidInput } from "../i18n/fail";

// What the refusal of a `@constraint` argument becomes: @nxgt/graphql-
// validation names the argument that refused in `issues[].constraint`. Plan
// §3.13 has one code for a bound (`out-of-range`) and one for the rest.
const constraintCodes: Record<string, ErrorCode> = {
  minLength: "validation.errors.too-short",
  maxLength: "validation.errors.too-long",
  min: "validation.errors.out-of-range",
  max: "validation.errors.out-of-range",
  exclusiveMin: "validation.errors.out-of-range",
  exclusiveMax: "validation.errors.out-of-range",
  multipleOf: "validation.errors.out-of-range",
  minItems: "validation.errors.too-few",
  maxItems: "validation.errors.too-many",
  format: "validation.errors.invalid-format",
  pattern: "validation.errors.invalid-format",
};

interface ConstraintIssue {
  path: readonly (string | number)[];
  constraint?: string;
}

// The issues of a @constraint refusal (BAD_USER_INPUT), as the resolver threw
// it or as graphql-js wrapped it with the field's location.
function constraintIssues(error: GraphQLError): ConstraintIssue[] | undefined {
  const source =
    error.extensions["code"] === "BAD_USER_INPUT" ? error : error.originalError;
  if (!(source instanceof GraphQLError)) return undefined;
  if (source.extensions["code"] !== "BAD_USER_INPUT") return undefined;
  const issues = source.extensions["issues"];
  return Array.isArray(issues) ? (issues as ConstraintIssue[]) : undefined;
}

// The app's shape of an invalid input (`invalidInput`) for a @constraint
// refusal, at the field's location; any other error as it is.
export function reshaped(error: GraphQLError): GraphQLError {
  const issues = constraintIssues(error);
  if (!issues) return error;
  return invalidInput(
    issues.map((issue) => ({
      path: inputPath(issue.path),
      code:
        (issue.constraint && constraintCodes[issue.constraint]) ||
        "validation.errors.invalid",
    })),
    {
      nodes: error.nodes ?? null,
      source: error.source ?? null,
      positions: error.positions ?? null,
      path: error.path ?? null,
    },
  );
}

// A Yoga plugin: @constraint refusals leave as every other invalid input does,
// `validation.errors.invalid-input` with `extensions.fields`. It rewrites the
// execution's result rather than masking, since Yoga logs as an error every
// error a `maskError` replaces.
export const apiErrors: Plugin = {
  onExecute: () => ({
    onExecuteDone: ({ result, setResult }) => {
      if (!("errors" in result) || !result.errors) return;
      const changed = result.errors.map(reshaped);
      if (changed.every((error, i) => error === result.errors?.[i])) return;
      setResult({ ...result, errors: changed });
    },
  }),
};
