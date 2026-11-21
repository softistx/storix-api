import type { TextRow, TextStore } from "@softistx/alxia-i18n";
import type { ClientSession, Db } from "mongodb";

// The `translations` collection as @softistx/alxia-i18n's `TextStore`. The Mongo field
// is `code`; the package calls it `key`. `createdAt` and `updatedAt` and the
// migration's session are this adapter's concern, not the package's.
export function textStore(
  db: Db,
  session: ClientSession | undefined,
): TextStore {
  const options = session === undefined ? {} : { session };
  const collection = db.collection("translations");
  return {
    async upsert(rows: readonly TextRow[]) {
      const now = new Date();
      const operations = rows.map(({ key, language, text }) => ({
        updateOne: {
          filter: { code: key, language },
          update: {
            $set: { text, updatedAt: now },
            $setOnInsert: { createdAt: now },
          },
          upsert: true,
        },
      }));
      if (operations.length === 0) return;
      await collection.bulkWrite(operations, options);
    },
    async remove(keys: readonly string[]) {
      await collection.deleteMany({ code: { $in: [...keys] } }, options);
    },
  };
}
