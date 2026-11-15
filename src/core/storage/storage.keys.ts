// Who may read a `files` key. The kernel cannot reach the node tree (a core
// module depends on no business module), so the `files` module registers the
// check when it loads, as `onMemberJoined` does for a new member.

export interface FileRead {
  key: string;
  accountId: string;
}

// `mongo` is the request's workspace database, as the module that registers
// the check knows it.
export type FileReader = (mongo: unknown, read: FileRead) => Promise<boolean>;

let reader: FileReader | undefined;

// Sets the check (one module owns it; a second call replaces the first).
export function onFileRead(check: FileReader): void {
  reader = check;
}

// Without a check registered nothing is readable: a `files` object is served
// only once a node holds its key.
export async function mayReadFile(
  mongo: unknown,
  read: FileRead,
): Promise<boolean> {
  return reader ? reader(mongo, read) : false;
}
