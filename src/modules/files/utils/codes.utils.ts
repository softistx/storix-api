// Whether `error` is a GraphQL error carrying the catalogue code.
export const hasCode = (code: string) => (error: unknown) =>
  (error as { extensions?: { code?: string } }).extensions?.code === code;

export const isQuotaExceeded = hasCode("quotas.errors.exceeded");

export const isNameTaken = hasCode("nodes.errors.name-taken");
