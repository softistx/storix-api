import { S3Client } from "bun";
import { BUCKET, type filesWorld } from "./files.harness";
import { setup } from "./nodes.harness";

// What the files specs share: reading an answer, counting the bucket's
// objects, and a member's workspace with its root and shortcuts to call it.
type Files = ReturnType<typeof filesWorld>;

export const code = (r: {
  errors?: readonly { extensions?: unknown }[] | undefined;
}) => (r.errors?.[0]?.extensions as { code?: string } | undefined)?.code;

// A field of an answer's data, or undefined.
export const field = <T>(
  r: { data?: Record<string, unknown> | null },
  name: string,
) => r.data?.[name] as T;

// How many objects the bucket holds.
export async function objects(files: Files) {
  const s3 = new S3Client({
    bucket: BUCKET,
    endpoint: files.ctx.s3.endpoint,
    accessKeyId: files.ctx.s3.accessKeyId,
    secretAccessKey: files.ctx.s3.secretAccessKey,
    region: files.ctx.s3.region,
  });
  return (await s3.list({ maxKeys: 1000 })).contents?.length ?? 0;
}

// A workspace with its owner, the owner's root, `send` (as the owner) and
// `file` (uploads a body and records it).
export async function areaOf(files: Files) {
  const s = await setup(files.ctx.w);
  const root = await s.owner.root();
  const { owner } = s.workspace;
  const send = (query: string, variables: Record<string, unknown>) =>
    s.w.send(owner, query, { ...s.at, variables });
  const file = (parentId: string, name: string, body?: string) =>
    files.addFile(owner, s.workspace.id, parentId, name, body);
  return { ...s, root, send, file };
}
