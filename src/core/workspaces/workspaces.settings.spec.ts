import { describe, expect, test } from "bun:test";
import { world } from "../../../test/workspaces.harness";

const SETTINGS = `{ trashDays versionsMax versionsDays }`;
const READ = `query { workspace { settings ${SETTINGS} } }`;
const UPDATE = `mutation($input: WorkspaceSettingsInput!) { updateWorkspaceSettings(input: $input) ${SETTINGS} }`;

describe("workspace settings", () => {
  test("read as defaults, changed field by field, never below their range", async () => {
    const w = await world();
    const { id, owner } = await w.workspaceOf();
    const at = { workspace: id };
    const first = await w.send(owner, READ, at);
    expect(first.data?.["workspace"]).toEqual({
      settings: { trashDays: 30, versionsMax: 20, versionsDays: 90 },
    });
    const changed = await w.send(owner, UPDATE, {
      ...at,
      variables: { input: { trashDays: 7 } },
    });
    expect(changed.data?.["updateWorkspaceSettings"]).toEqual({
      trashDays: 7,
      versionsMax: 20,
      versionsDays: 90,
    });
    const refused = await w.send(owner, UPDATE, {
      ...at,
      variables: { input: { versionsMax: 0 } },
    });
    expect(refused.errors?.[0]?.extensions?.["code"]).toBe(
      "validation.errors.invalid-input",
    );
  });
});
