import type { Resolvers } from "@/generated/graphql/resolvers";

// The `Mutation` map the resolver files fill a part of each.
export type Mutations = NonNullable<Resolvers["Mutation"]>;
