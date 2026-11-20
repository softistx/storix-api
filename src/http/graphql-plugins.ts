import { apiErrors } from "./api-errors";
import { requireClientHeader } from "./csrf";
import { noStore } from "./no-store";

// The graxia plugins of /graphql, in order: no-store first, since `respond`
// skips the plugins after the one that answers.
export const graphqlPlugins = [noStore, requireClientHeader, apiErrors];
