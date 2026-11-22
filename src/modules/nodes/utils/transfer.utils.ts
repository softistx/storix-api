const MAX_LABEL = 200;

// The folder a leaver's files arrive in: `Files of <name>`. A name is data of
// the account, so what a node name refuses (a slash, a control character) is
// dropped, and a missing one is "a former member".
export function transferLabel(name: string | null): string {
  const clean = (name ?? "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the rule (checkName)
    .replace(/[/\\\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LABEL);
  return `Files of ${clean === "" ? "a former member" : clean}`;
}
