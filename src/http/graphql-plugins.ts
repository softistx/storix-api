import { requireClientHeader } from "./csrf";
import { noStore } from "./no-store";

// The Yoga plugins of /graphql, in order. A1 adds the error plugin
// (`apiErrors`) in front of `noStore`.
export const graphqlPlugins = [requireClientHeader, noStore];
