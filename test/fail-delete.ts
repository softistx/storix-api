import { spyOn } from "bun:test";
import { Collection } from "mongodb";

// Makes the Nth `deleteMany` on a collection fail, the way a transaction that
// aborts does; the others run as they are. The caller restores the spy.
export function failDeleteOn(collection: string, nth: number) {
  const original = Collection.prototype.deleteMany;
  let calls = 0;
  return spyOn(Collection.prototype, "deleteMany").mockImplementation(
    async function (this: Collection, ...args: never[]) {
      if (this.collectionName === collection && ++calls === nth) {
        throw new Error("disk full");
      }
      return Reflect.apply(original, this, args);
    } as never,
  );
}
