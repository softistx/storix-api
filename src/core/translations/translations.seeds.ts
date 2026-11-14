import type { ClientSession, Db } from "mongodb";

// Seeds for a data migration: the texts of each language by code. A code a
// language lacks is refused, so no migration ships a half-translated code.
export type Texts = Readonly<Record<string, Readonly<Record<string, string>>>>;

export interface Seed {
  code: string;
  language: string;
  text: string;
}

export function seedsOf(texts: Texts): Seed[] {
  const languages = Object.keys(texts);
  const codes = new Set(Object.values(texts).flatMap((t) => Object.keys(t)));
  return [...codes].sort().flatMap((code) =>
    languages.map((language) => {
      const text = texts[language]?.[code];
      if (text === undefined) {
        throw new TypeError(`translation "${code}" has no ${language} text`);
      }
      return { code, language, text };
    }),
  );
}

// Adds the texts, or changes the text a code has in a language. A row is never
// deleted by an upsert; `down` of the migration that created it removes it.
export async function upsertTexts(
  db: Db,
  session: ClientSession | undefined,
  texts: Texts,
): Promise<void> {
  const now = new Date();
  const operations = seedsOf(texts).map(({ code, language, text }) => ({
    updateOne: {
      filter: { code, language },
      update: {
        $set: { text, updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      upsert: true,
    },
  }));
  if (operations.length === 0) return;
  await db
    .collection("translations")
    .bulkWrite(operations, session === undefined ? {} : { session });
}

export async function removeTexts(
  db: Db,
  session: ClientSession | undefined,
  texts: Texts,
): Promise<void> {
  const codes = [...new Set(Object.values(texts).flatMap(Object.keys))];
  await db
    .collection("translations")
    .deleteMany(
      { code: { $in: codes } },
      session === undefined ? {} : { session },
    );
}
