import { defineModule } from "@alxia/modules";
import { onFileRead } from "@/core/storage";
import { files as codes } from "@/i18n/codes";
import type { NodesMongo } from "@/modules/nodes/public";
import { blobs, recents, stars } from "./files.collection";
import typeDefs from "./files.graphqls" with { type: "text" };
import { filesResolvers } from "./files.resolver";
import { mayRead } from "./files.service";

// The files of a workspace: the blobs the uploads become and the recording of
// an upload as a file node (plan §3.2). The nodes themselves, their listing
// and their fields are the `nodes` module's; permissions are its `nodes:read`
// and `nodes:manage`. It tells the `/media` routes which keys a caller may
// read.
export const filesModule = defineModule({
  name: "files",
  dependsOn: ["nodes", "members", "workspaces", "audit", "storage"],
  collections: { blobs, stars, recents },
  codes,
  typeDefs: [typeDefs],
  resolvers: filesResolvers,
});

onFileRead((mongo, read) => mayRead(mongo as NodesMongo, read));
