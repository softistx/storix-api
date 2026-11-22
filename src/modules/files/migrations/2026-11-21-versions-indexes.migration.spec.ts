import { describe, expect, test } from "bun:test";
import { connection } from "@/config/db";
import { versionsIndexes } from "./2026-11-21-versions-indexes.migration";

describe("the versions indexes migration", () => {
  const context = (database: ReturnType<typeof connection.client.db>) => ({
    db: database,
    client: connection.client,
    session: undefined,
  });

  test("builds the two indexes once, and leaves a database with no versions alone", async () => {
    const empty = connection.client.db("storix_versions_indexes_empty");
    await versionsIndexes.up(context(empty));
    expect(await empty.listCollections({ name: "versions" }).toArray()).toEqual(
      [],
    );

    const database = connection.client.db("storix_versions_indexes");
    await database.collection("versions").insertOne({ fileId: 1, number: 1 });
    await versionsIndexes.up(context(database));
    const built = await database.collection("versions").indexes();
    expect(built.find((i) => i.name === "versions_number")).toMatchObject({
      key: { fileId: 1, number: 1 },
      unique: true,
    });
    expect(built.find((i) => i.name === "versions_blob")?.key).toEqual({
      blobKey: 1,
    });
    const before = JSON.stringify(built);
    await versionsIndexes.up(context(database));
    expect(
      JSON.stringify(await database.collection("versions").indexes()),
    ).toBe(before);
  });
});
