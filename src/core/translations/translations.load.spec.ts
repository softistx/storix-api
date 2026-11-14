import { beforeAll, describe, expect, test } from "bun:test";
import { migrate } from "@softistx/mongo/migrations";
import { connection, core } from "@/config/db";
import { env } from "@/config/env";
import { migrations } from "@/config/migrations";
import { i18n } from "@/i18n";
import { errorCodes } from "@/i18n/codes";
import {
  buildServed,
  catalogueOfLanguage,
  errorMessages,
  loadTranslations,
  translationsLoaded,
} from "./translations.load";

const db = connection.client.db(env.MONGO_CORE_DATABASE);

beforeAll(async () => {
  await migrate(db, [...migrations]);
});

describe("buildServed", () => {
  const rows = [
    { code: "x.errors.a", language: "en", text: "A" },
    { code: "x.errors.b", language: "en", text: "B" },
    { code: "x.errors.a", language: "fr", text: "Fa" },
  ];

  test("fills a code a language lacks from English, in code order", () => {
    const { served } = buildServed(rows, ["x.errors.b", "x.errors.a"]);
    expect(served.get("fr")?.messages).toEqual([
      { code: "x.errors.b", message: "B" },
      { code: "x.errors.a", message: "Fa" },
    ]);
  });

  test("the version of a language changes with its own text and with English's", () => {
    const before = buildServed(rows, ["x.errors.a"]).served;
    const frenchEdited = buildServed(
      rows.map((r) => (r.language === "fr" ? { ...r, text: "Fa2" } : r)),
      ["x.errors.a"],
    ).served;
    const englishEdited = buildServed(
      rows.map((r) => (r.code === "x.errors.b" ? { ...r, text: "B2" } : r)),
      ["x.errors.a"],
    ).served;
    expect(frenchEdited.get("fr")?.version).not.toBe(before.get("fr")?.version);
    expect(frenchEdited.get("en")?.version).toBe(before.get("en")?.version);
    expect(englishEdited.get("fr")?.version).not.toBe(
      before.get("fr")?.version,
    );
  });
});

describe("loadTranslations", () => {
  test("serves every code of the inventory in both languages", async () => {
    await loadTranslations(core);
    expect(translationsLoaded()).toBe(true);
    for (const language of ["en", "fr"]) {
      expect(errorMessages(language).map((m) => m.code)).toEqual([
        ...errorCodes,
      ]);
    }
    expect(
      errorMessages("fr").find((m) => m.code === "auth.errors.forbidden")
        ?.message,
    ).toBe("Vous n’avez pas le droit de faire cela.");
  });

  test("gives the texts to i18n", async () => {
    await loadTranslations(core);
    expect(i18n.supported).toEqual(["en", "fr"]);
    expect(i18n.t("auth.errors.forbidden")).toBe(
      "You are not allowed to do this.",
    );
  });

  test("a changed text changes the version of the language, a reload does not", async () => {
    await loadTranslations(core);
    const before = catalogueOfLanguage("fr").version;
    await loadTranslations(core);
    expect(catalogueOfLanguage("fr").version).toBe(before);

    const filter = { code: "auth.errors.forbidden", language: "fr" };
    const original = await core.db.translations.raw.findOne(filter);
    try {
      await core.db.translations.raw.updateOne(filter, {
        $set: { text: "Interdit." },
      });
      await loadTranslations(core);
      expect(catalogueOfLanguage("fr").version).not.toBe(before);
      expect(
        errorMessages("fr").find((m) => m.code === filter.code)?.message,
      ).toBe("Interdit.");
    } finally {
      await core.db.translations.raw.updateOne(filter, {
        $set: { text: original?.text ?? "" },
      });
      await loadTranslations(core);
    }
    expect(catalogueOfLanguage("fr").version).toBe(before);
  });

  test("refuses to load when a code has no text in the fallback language", async () => {
    const filter = { code: "auth.errors.forbidden", language: "en" };
    const original = await core.db.translations.raw.findOne(filter);
    try {
      await core.db.translations.raw.deleteOne(filter);
      await expect(loadTranslations(core)).rejects.toThrow(
        "no fallback-language text for auth.errors.forbidden (en)",
      );
    } finally {
      if (original) await core.db.translations.raw.insertOne(original);
      await loadTranslations(core);
    }
  });

  test("a language that is not shipped is refused", async () => {
    await loadTranslations(core);
    expect(() => catalogueOfLanguage("de")).toThrow('no language "de"');
  });
});
