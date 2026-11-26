import { mediaPlace, newMediaKey } from "@softistx/alxia-media";
import { store } from "@/config/tenancy";
import { ADD, type filesWorld } from "../../../../test/files.harness";
import { setup } from "../../nodes/nodes.harness";
import { filesMongo } from "../models";
import { type SweepBucket, sweepWorkspace } from "./index";

type FilesWorld = ReturnType<typeof filesWorld>;

export const HOUR = 60 * 60_000;
export const later = () => new Date(Date.now() + 2 * HOUR);

const databaseOf = async (id: string) => filesMongo(await store.databaseOf(id));

export async function area(files: FilesWorld) {
  const s = await setup(files.ctx.w);
  const { id, owner } = s.workspace;
  const root = await s.owner.root();
  const mongo = await databaseOf(id);
  const place = mediaPlace("files", `workspaces/${id}`);
  const bucket = files.ctx.bucket as SweepBucket;
  const keys = async () =>
    (
      await bucket.list({ prefix: `workspaces/${id}/files/`, limit: 1000 })
    ).items
      .map((item) => item.key)
      .sort();
  // An object nobody recorded, as a /media PUT that `addFile` never saw.
  const stray = async (key = newMediaKey(), sizes: string[] = []) => {
    for (const name of ["", ...sizes.map((size) => `/${size}`)]) {
      await files.ctx.bucket.put({ key: place(key) + name }, "x", {
        type: "text/plain",
      });
    }
    return key;
  };
  const record = (key: string, name: string) =>
    s.w.send(owner, ADD, {
      workspace: id,
      variables: { input: { key, name, parentId: root.id } },
    });
  const upload = (body: string) => files.upload(owner, id, body);
  const sweep = (over = {}, on: SweepBucket = bucket) =>
    sweepWorkspace(mongo, on, id, { log: () => {}, ...over });
  return {
    ...s,
    id,
    owner,
    root,
    mongo,
    place,
    keys,
    stray,
    record,
    upload,
    sweep,
    bucket,
  };
}
