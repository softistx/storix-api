import { defineModule } from "@softistx/alxia-modules";
import { files, versions } from "./files.errors";
import typeDefs from "./files.graphqls" with { type: "text" };
import { versionsIndexes } from "./migrations/2026-11-21-versions-indexes.migration";
import { nodesListingDescIndexes } from "./migrations/2026-11-24-nodes-listing-desc-indexes.migration";
import { nodesLargestIndex } from "./migrations/2026-11-26-nodes-largest-index.migration";
import { nodesCropsIndex } from "./migrations/2026-11-27-nodes-crops-index.migration";
import { blobsCropsIndex } from "./migrations/2026-11-28-blobs-crops-index.migration";
import { nodesCropsRedo } from "./migrations/2026-11-28-nodes-crops-redo.migration";
import {
  blobs,
  recents,
  stars,
  sweepLocks,
  versions as versionRows,
} from "./models";
import { filesResolvers } from "./resolvers";

// The files of a workspace: the blobs the uploads become and the recording of
// an upload as a file node (plan §3.2). The nodes themselves, their listing
// and their fields are the `nodes` module's; permissions are its `nodes:read`
// and `nodes:manage`. Which keys a caller may read through `/media` is its
// `fileReader` (public.ts), handed to the routes by the app.
export const filesModule = defineModule({
  name: "files",
  dependsOn: ["nodes", "members", "workspaces", "audit", "storage", "shares"],
  migrations: [
    versionsIndexes,
    nodesListingDescIndexes,
    nodesLargestIndex,
    nodesCropsIndex,
    blobsCropsIndex,
    nodesCropsRedo,
  ],
  collections: { blobs, stars, recents, sweepLocks, versions: versionRows },
  codes: [...files, ...versions],
  typeDefs: [typeDefs],
  resolvers: filesResolvers,
});
