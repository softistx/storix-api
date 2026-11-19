import { defineModule } from "@alxia/modules";
import { files, versions } from "@/i18n/codes";
import {
  blobs,
  recents,
  stars,
  versions as versionRows,
} from "./files.collection";
import typeDefs from "./files.graphqls" with { type: "text" };
import { filesResolvers } from "./files.resolver";
import { versionsIndexes } from "./migrations/2026-11-21-versions-indexes.migration";
import { nodesListingDescIndexes } from "./migrations/2026-11-24-nodes-listing-desc-indexes.migration";

// The files of a workspace: the blobs the uploads become and the recording of
// an upload as a file node (plan §3.2). The nodes themselves, their listing
// and their fields are the `nodes` module's; permissions are its `nodes:read`
// and `nodes:manage`. Which keys a caller may read through `/media` is its
// `fileReader` (public.ts), handed to the routes by the app.
export const filesModule = defineModule({
  name: "files",
  dependsOn: ["nodes", "members", "workspaces", "audit", "storage"],
  migrations: [versionsIndexes, nodesListingDescIndexes],
  collections: { blobs, stars, recents, versions: versionRows },
  codes: [...files, ...versions],
  typeDefs: [typeDefs],
  resolvers: filesResolvers,
});
