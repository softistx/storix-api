import { apiErrors } from "./api-errors";
import { requireClientHeader } from "./csrf";
import { noStore } from "./no-store";

// The Yoga plugins of /graphql, in order.
export const graphqlPlugins = [requireClientHeader, apiErrors, noStore];
