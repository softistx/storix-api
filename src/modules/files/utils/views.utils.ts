import { nodeView } from "@/modules/nodes/public";
import { notAFile } from "../files.errors";
import type { PersonalPage } from "../services";

// A personal page as the API says it: the nodes and the cursor to go on.
export const pageOf = (
  page: PersonalPage,
  after: string | null | undefined,
) => ({
  nodes: page.items.map(nodeView),
  pageInfo: {
    startCursor: null,
    endCursor: page.endCursor,
    hasNextPage: page.endCursor !== null,
    hasPreviousPage: after != null,
  },
});

// The node as the API's `File`; a folder is `not-a-file`.
export const fileOf = (node: Parameters<typeof nodeView>[0]) => {
  const view = nodeView(node);
  if (view.__typename !== "File") throw notAFile();
  return view;
};
