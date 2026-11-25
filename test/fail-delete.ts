import { spyOn } from "bun:test";
import { Collection } from "mongodb";

// Makes the Nth `deleteMany` on a collection of one workspace's database fail,
// the way a transaction that aborts does; the others run as they are. The
// spy patches the driver for the whole process, so it counts only the calls on
// that workspace's database: another workspace's background work (a worker, a
// retention pass of an earlier spec) never uses up the count nor fails.
// The caller restores the spy.
export function failDeleteOn(
  collection: string,
  nth: number,
  workspaceId: string,
) {
  const original = Collection.prototype.deleteMany;
  let calls = 0;
  return spyOn(Collection.prototype, "deleteMany").mockImplementation(
    async function (this: Collection, ...args: never[]) {
      if (
        this.collectionName === collection &&
        this.dbName.endsWith(workspaceId) &&
        ++calls === nth
      ) {
        throw new Error("disk full");
      }
      return Reflect.apply(original, this, args);
    } as never,
  );
}
