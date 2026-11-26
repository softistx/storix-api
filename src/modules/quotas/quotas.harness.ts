import { S3Client } from "bun";
import { store } from "@/config/tenancy";
import { workspacesMongo } from "@/core/workspaces";
import { BUCKET, type filesWorld } from "../../../test/files.harness";
import { filesMongo } from "../files/public";
import { setup } from "../nodes/nodes.harness";

type FilesWorld = ReturnType<typeof filesWorld>;

export const core = () => workspacesMongo(store.core);
export const databaseOf = async (id: string) =>
  filesMongo(await store.databaseOf(id));

export const code = (r: {
  errors?: readonly { extensions?: unknown }[] | undefined;
}) => (r.errors?.[0]?.extensions as { code?: string } | undefined)?.code;

// The number of objects in the bucket.
export async function objects(files: FilesWorld) {
  const s3 = new S3Client({
    bucket: BUCKET,
    endpoint: files.ctx.s3.endpoint,
    accessKeyId: files.ctx.s3.accessKeyId,
    secretAccessKey: files.ctx.s3.secretAccessKey,
    region: files.ctx.s3.region,
  });
  return (await s3.list({ maxKeys: 1000 })).contents?.length ?? 0;
}

export const STORAGE = `{ storage { quotaBytes usedBytes currentBytes versionBytes trashBytes files } }`;

export async function area(files: FilesWorld) {
  const s = await setup(files.ctx.w);
  const root = await s.owner.root();
  const { owner, id, slug } = s.workspace;
  const send = (query: string, variables?: Record<string, unknown>) =>
    s.w.send(owner, query, {
      ...s.at,
      ...(variables && { variables }),
    });
  const storage = async () =>
    (await send(STORAGE)).data?.["storage"] as Record<string, number>;
  const stored = async () => {
    const doc = await core().db.workspaces.getById(id);
    return doc.usage;
  };
  return { ...s, root, send, storage, stored, user: owner, id, slug };
}
