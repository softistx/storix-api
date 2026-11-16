// Who may read a `files` key. The kernel cannot reach the node tree (a core
// module depends on no business module), so the application hands the media
// routes a check written by the `files` module (`createApp`, src/app.ts):
// there is no registry to fill and no state to reset between two apps.

export interface FileRead {
  key: string;
  accountId: string;
}

// `mongo` is the request's workspace database, as the module that writes the
// check knows it.
export type FileReader = (mongo: unknown, read: FileRead) => Promise<boolean>;
