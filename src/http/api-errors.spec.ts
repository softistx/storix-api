import { describe, expect, test } from "bun:test";
import { GraphQLError } from "graphql";
import { apiErrors } from "./api-errors";

// What Yoga hands the plugin: the execution result, which the plugin may
// replace through `setResult`.
function run(errors: GraphQLError[]) {
  let replaced: { errors?: readonly GraphQLError[] } | undefined;
  const hooks = (
    apiErrors.onExecute as unknown as () => {
      onExecuteDone: (payload: unknown) => void;
    }
  )();
  hooks.onExecuteDone({
    result: { errors },
    setResult: (result: typeof replaced) => {
      replaced = result;
    },
  });
  return replaced;
}

describe("apiErrors", () => {
  test("a wrapped @constraint refusal becomes invalid-input with coded fields", () => {
    const inner = new GraphQLError("Invalid input", {
      extensions: {
        code: "BAD_USER_INPUT",
        issues: [
          { path: ["input", "name"], constraint: "maxLength", value: 100 },
          { path: ["input", "age"], constraint: "min", value: 18 },
        ],
      },
    });
    const outer = new GraphQLError(inner.message, {
      path: ["createNode"],
      originalError: inner,
    });
    const [error] = run([outer])?.errors ?? [];
    expect(error?.extensions["code"]).toBe("validation.errors.invalid-input");
    expect(error?.path).toEqual(["createNode"]);
    expect(error?.originalError).toBe(outer);
    const fields = error?.extensions["fields"] as {
      path: string;
      code: string;
      params?: unknown;
    }[];
    expect(fields).toMatchObject([
      {
        path: "name",
        code: "validation.errors.too-long",
        params: { max: 100 },
      },
      {
        path: "age",
        code: "validation.errors.out-of-range",
        params: { min: 18 },
      },
    ]);
  });

  test("leaves any other error alone", () => {
    expect(run([new GraphQLError("boom")])).toBeUndefined();
  });
});
