import { describe, expect, test } from "bun:test";
import type { MediaBucket } from "@softistx/alxia-media";
import { mediaPlace, newMediaKey } from "@softistx/alxia-media";
import { discardObject, storedObject } from "./object.utils";

function opened(size: number | undefined, contentType?: string) {
  return {
    size,
    contentType,
    stream: { cancel: async () => undefined },
  };
}

const bucketOf = (open: (args: { key: string }) => unknown) =>
  ({ open }) as unknown as MediaBucket;

describe("storedObject", () => {
  test("answers the size and the type without its parameters", async () => {
    const key = newMediaKey();
    const seen: string[] = [];
    const bucket = bucketOf(async ({ key: k }) => {
      seen.push(k);
      return opened(12, "Text/Plain;charset=utf-8");
    });
    expect(await storedObject(bucket, "w1", key)).toEqual({
      size: 12,
      mimeType: "text/plain",
    });
    expect(seen).toEqual([mediaPlace("files", "workspaces/w1")(key)]);
  });

  test("refuses an unknown, malformed or empty object with key-unknown", async () => {
    const key = newMediaKey();
    const missing = bucketOf(async () => null);
    const empty = bucketOf(async () => opened(0));
    for (const [bucket, k] of [
      [missing, key],
      [empty, key],
      [missing, "not-a-key"],
    ] as const) {
      await expect(storedObject(bucket, "w1", k)).rejects.toMatchObject({
        extensions: { code: "files.errors.key-unknown" },
      });
    }
  });

  test("is 503 without a bucket or when the bucket fails", async () => {
    const key = newMediaKey();
    const failing = bucketOf(async () => {
      throw new Error("down");
    });
    for (const bucket of [undefined, failing]) {
      await expect(storedObject(bucket, "w1", key)).rejects.toMatchObject({
        extensions: { code: "storage.errors.unavailable" },
      });
    }
  });
});

describe("discardObject", () => {
  test("deletes the object and never throws", async () => {
    const key = newMediaKey();
    const deleted: string[] = [];
    const bucket = {
      delete: async ({ key: k }: { key: string }) => {
        deleted.push(k);
      },
    } as unknown as MediaBucket;
    await discardObject(bucket, "w1", key);
    expect(deleted).toEqual([mediaPlace("files", "workspaces/w1")(key)]);
    await discardObject(undefined, "w1", key);
    const failing = {
      delete: async () => {
        throw new Error("down");
      },
    } as unknown as MediaBucket;
    await discardObject(failing, "w1", key);
  });
});
