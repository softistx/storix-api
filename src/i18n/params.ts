// The values a message interpolates (`{minutes}`, `{name}`): numbers and
// strings, carried raw as `extensions.params` so a client can word the refusal
// itself.
export type Params = Record<string, string | number>;
