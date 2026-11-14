import { beforeAll, describe, expect, test } from "bun:test";
import { catalogueOf, uncovered } from "@alxia/i18n";
import { codesOf } from "@alxia/modules";
import { FIELD_CODES } from "@nxgt/graphql-validation";
import { migrate } from "@softistx/mongo/migrations";
import { Glob } from "bun";
import { connection, core } from "../config/db";
import { env } from "../config/env";
import { migrations } from "../config/migrations";
import { modules } from "../modules/registry";
import { missingCodes } from "../scripts/context-codes-check";
import { type ErrorCode, errorCodes } from "./codes";
import { LANGUAGES } from "./index";

// The inventory in code (`ErrorCode`) against the messages in the database
// (the migrations): every code is translated in every shipped language, no
// code hides in the source, and CONTEXT.md lists each code.
let rows: { code: string; language: string; text: string }[] = [];
const textRows = () =>
  rows.map(({ code, language, text }) => ({ key: code, language, text }));

beforeAll(async () => {
  await migrate(connection.client.db(env.MONGO_CORE_DATABASE), [...migrations]);
  rows = await core.db.translations.raw.find({}).toArray();
});

describe("the error codes and their translations", () => {
  test("the inventory has no code twice", () => {
    expect(new Set(errorCodes).size).toBe(errorCodes.length);
  });

  test("english and french are shipped", () => {
    expect([...LANGUAGES]).toEqual(["en", "fr"]);
  });

  test("every code has a message in every shipped language", () => {
    for (const language of LANGUAGES) {
      expect(
        uncovered(errorCodes, catalogueOf(textRows(), language)).map(
          (code) => `${code} (${language})`,
        ),
      ).toEqual([]);
    }
  });

  test("every text of a code namespace is a code of the inventory", () => {
    const known = new Set<string>(errorCodes);
    const strays = rows
      .filter((row) => /\.errors\./.test(row.code) && !known.has(row.code))
      .map((row) => row.code);
    expect(strays).toEqual([]);
  });

  test("no French text has a plain space before ? : ; !", () => {
    const plain = rows
      .filter((row) => row.language === "fr" && / [?:;!]/.test(row.text))
      .map((row) => row.code);
    expect(plain).toEqual([]);
  });

  test("every language of a code names the same arguments", () => {
    const names = (text: string) =>
      [...text.matchAll(/\{\s*([A-Za-z_][\w]*)/g)]
        .map((m) => m[1])
        .sort()
        .join(",");
    const byCode = Map.groupBy(rows, (row) => row.code);
    const differing = [...byCode]
      .filter(([, group]) => new Set(group.map((r) => names(r.text))).size > 1)
      .map(([code]) => code);
    expect(differing).toEqual([]);
  });

  test("the registered modules declare codes the inventory holds", () => {
    const known = new Set<string>(errorCodes);
    expect(codesOf(modules).filter((code) => !known.has(code))).toEqual([]);
    expect([...codesOf(modules)].sort()).toEqual([...errorCodes].sort());
  });

  test("the codes of @nxgt/graphql-validation's field issues are in the inventory", () => {
    const known = new Set<string>(errorCodes);
    expect(
      Object.values(FIELD_CODES).filter((code) => !known.has(code)),
    ).toEqual([]);
  });

  test("no code appears in the source that the inventory lacks", async () => {
    const known = new Set<string>(errorCodes);
    const literal = /["'`]([a-z][a-z-]*\.errors\.[a-z0-9-]+)["'`]/g;
    const strays: string[] = [];
    for await (const path of new Glob("src/**/*.ts").scan(".")) {
      if (/\.spec\.ts$|^src\/generated\//.test(path)) continue;
      const text = await Bun.file(path).text();
      for (const [, code] of text.matchAll(literal)) {
        if (!known.has(code as ErrorCode)) strays.push(`${path}: ${code}`);
      }
    }
    expect(strays).toEqual([]);
  });

  test("every code has a row in CONTEXT.md", async () => {
    const context = await Bun.file("CONTEXT.md").text();
    expect(missingCodes([...errorCodes], context)).toEqual([]);
  });
});
