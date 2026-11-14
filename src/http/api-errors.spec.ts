import { describe, expect, test } from "bun:test";
import { GraphQLError } from "graphql";
import { reshaped } from "./api-errors";

const refusal = (issues: unknown[]) =>
  new GraphQLError("Invalid input", {
    extensions: { code: "BAD_USER_INPUT", issues },
  });

// graphql-js wraps a resolver's error with the field's location.
const wrapped = (inner: GraphQLError) =>
  new GraphQLError(inner.message, {
    path: ["createNode"],
    originalError: inner,
  });

const fieldsOf = (error: GraphQLError) =>
  error.extensions["fields"] as {
    path: string;
    code: string;
    params?: unknown;
  }[];

describe("reshaped", () => {
  test("leaves any other error as it is", () => {
    const other = new GraphQLError("boom");
    expect(reshaped(other)).toBe(other);
  });

  test("a wrapped @constraint refusal becomes invalid-input with each field's code and limit", () => {
    const inner = refusal([
      { path: ["input", "name"], constraint: "maxLength", value: 100 },
      { path: ["input", "age"], constraint: "min", value: 18 },
    ]);
    const error = reshaped(wrapped(inner));
    expect(error.extensions["code"]).toBe("validation.errors.invalid-input");
    expect(error.path).toEqual(["createNode"]);
    expect(error.originalError).toBe(inner);
    expect(fieldsOf(error)).toMatchObject([
      { code: "validation.errors.too-long", params: { max: 100 } },
      { code: "validation.errors.out-of-range", params: { min: 18 } },
    ]);
  });

  test("a direct, unwrapped BAD_USER_INPUT refusal is reshaped too", () => {
    const error = reshaped(
      refusal([{ path: ["input", "tags"], constraint: "maxItems", value: 5 }]),
    );
    expect(error.extensions["code"]).toBe("validation.errors.invalid-input");
    expect(fieldsOf(error)).toMatchObject([
      { code: "validation.errors.too-many", params: { max: 5 } },
    ]);
  });

  test("a refusal with no constraint falls back to validation.errors.invalid, with no params", () => {
    const error = reshaped(refusal([{ path: ["input", "name"] }]));
    const [field] = fieldsOf(error);
    expect(field?.code).toBe("validation.errors.invalid");
    expect(field?.params).toBeUndefined();
  });

  test("a constraint with no plain bound sets no params", () => {
    const [field] = fieldsOf(
      reshaped(
        refusal([
          { path: ["input", "slug"], constraint: "pattern", value: "^a$" },
        ]),
      ),
    );
    expect(field?.code).toBe("validation.errors.invalid-format");
    expect(field?.params).toBeUndefined();
  });
});
