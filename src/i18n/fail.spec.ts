import { beforeAll, describe, expect, test } from "bun:test";
import { defineModule } from "@softistx/alxia-modules";
import { migrate } from "@softistx/mongo/migrations";
import { createApp } from "@/app";
import { connection, core } from "@/config/db";
import { env } from "@/config/env";
import { migrations } from "@/config/migrations";
import { system } from "@/core/system/module";
import { loadTranslations } from "@/core/translations/translations.load";
import type { Resolvers } from "@/generated/graphql/resolvers";
import { clientHeader } from "@/http/csrf";
import { schemaOf } from "@/http/schema";
import { fail, forbidden, invalidInput, unauthenticated } from "./fail";

beforeAll(async () => {
  await migrate(connection.client.db(env.MONGO_CORE_DATABASE), [...migrations]);
  await loadTranslations(core);
});

describe("fail", () => {
  test("carries the code, and only what was given", () => {
    expect(fail("auth.errors.forbidden").extensions).toEqual({
      code: "auth.errors.forbidden",
    });
    expect(
      fail("auth.errors.rate-limited", {
        params: { minutes: 2 },
        status: 429,
        field: "email",
      }).extensions,
    ).toEqual({
      code: "auth.errors.rate-limited",
      params: { minutes: 2 },
      http: { status: 429 },
      field: "email",
    });
  });

  test("words the message with its params, in the fallback language outside a request", () => {
    expect(
      fail("auth.errors.rate-limited", { params: { minutes: 1 } }).message,
    ).toBe("Too many attempts. Try again in 1 minute.");
    expect(
      fail("auth.errors.rate-limited", { params: { minutes: 5 } }).message,
    ).toBe("Too many attempts. Try again in 5 minutes.");
  });

  test("forbidden and unauthenticated carry their status", () => {
    expect(forbidden().extensions["http"]).toEqual({ status: 403 });
    expect(unauthenticated().extensions["http"]).toEqual({ status: 401 });
  });

  test("invalidInput lists each field with its translated message", () => {
    const error = invalidInput([
      { path: "name", code: "validation.errors.too-short" },
      { path: "tags", code: "validation.errors.too-many" },
    ]);
    expect(error.extensions["code"]).toBe("validation.errors.invalid-input");
    expect(error.extensions["http"]).toEqual({ status: 400 });
    expect(error.message).toBe("Some fields are not valid.");
    expect(error.extensions["fields"]).toEqual([
      {
        path: "name",
        code: "validation.errors.too-short",
        message: "This value is too short.",
      },
      {
        path: "tags",
        code: "validation.errors.too-many",
        message: "There are too many items.",
      },
    ]);
  });
});

interface Refusal {
  message: string;
  extensions: {
    code: string;
    fields: { path: string; code: string }[];
  };
}

// A refusal over HTTP: the message in the request's language, the status graxia
// answers, and an @constraint refusal worded as `invalid-input`.
const resolvers: Resolvers = {
  Query: {
    refuse: () => {
      throw fail("auth.errors.forbidden", { status: 403 });
    },
    bounded: () => 1,
  },
};
const sample = defineModule({
  name: "sample",
  typeDefs: [
    "extend type Query { refuse: Int bounded(n: Int @constraint(min: 1, max: 5), s: String @constraint(minLength: 3)): Int }",
  ],
  resolvers,
});
const app = createApp({ schema: schemaOf([system, sample]) });
const ask = (query: string, headers: Record<string, string> = {}) =>
  app.fetch(
    new Request("http://localhost/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [clientHeader]: "spec",
        ...headers,
      },
      body: JSON.stringify({ query }),
    }),
  );

describe("a refusal over HTTP", () => {
  test("answers its status, its code and its message in the request's language", async () => {
    const response = await ask("{ refuse }", { "accept-language": "fr" });
    expect(response.status).toBe(403);
    const { errors } = (await response.json()) as { errors: [Refusal] };
    expect(errors[0].message).toBe("Vous n’avez pas le droit de faire cela.");
    expect(errors[0].extensions).toMatchObject({
      code: "auth.errors.forbidden",
    });
  });

  test("an @constraint refusal becomes validation.errors.invalid-input with its fields", async () => {
    const response = await ask('{ bounded(n: 9, s: "ab") }', {
      "accept-language": "fr",
    });
    expect(response.status).toBe(400);
    const { errors } = (await response.json()) as { errors: [Refusal] };
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("Certains champs ne sont pas valides.");
    expect(errors[0].extensions.code).toBe("validation.errors.invalid-input");
    expect(errors[0].extensions.fields.map((f) => [f.path, f.code])).toEqual([
      ["n", "validation.errors.out-of-range"],
      ["s", "validation.errors.too-short"],
    ]);
  });
});
