import { describe, expect, spyOn, test } from "bun:test";
import { world } from "../../../../test/workspaces.harness";
import type { Settings } from "../services";
import * as services from "../services";

const MINE = `{ myWorkspaces { id settings { trashDays versionsMax versionsDays } } }`;
const UPDATE = `mutation($input: WorkspaceSettingsInput!) { updateWorkspaceSettings(input: $input) { trashDays } }`;

describe("Workspace.settings loader", () => {
  test("a list of workspaces reads every settings in one query", async () => {
    const w = await world();
    const first = await w.workspaceOf();
    const second = await w.workspaceOf(first.owner);
    const third = await w.workspaceOf(first.owner);
    await w.send(first.owner, UPDATE, {
      workspace: second.id,
      variables: { input: { trashDays: 7 } },
    });
    const batches = spyOn(services, "settingsOfMany");
    const result = await w.send(first.owner, MINE);
    // One batch for the request, holding the three workspaces.
    expect(batches.mock.calls).toHaveLength(1);
    expect(batches.mock.calls[0]?.[1]).toHaveLength(3);
    batches.mockRestore();
    const listed = result.data?.["myWorkspaces"] as {
      id: string;
      settings: Settings;
    }[];
    const byId = new Map(listed.map((ws) => [ws.id, ws.settings]));
    expect(byId.size).toBe(3);
    expect(byId.get(first.id)?.trashDays).toBe(30);
    expect(byId.get(second.id)?.trashDays).toBe(7);
    expect(byId.get(third.id)).toEqual({
      trashDays: 30,
      versionsMax: 20,
      versionsDays: 90,
    });
  });

  test("a workspace's settings stay its own, never another's", async () => {
    const w = await world();
    const a = await w.workspaceOf();
    const b = await w.workspaceOf();
    await w.send(b.owner, UPDATE, {
      workspace: b.id,
      variables: { input: { trashDays: 3 } },
    });
    const mine = await w.send(a.owner, MINE);
    expect(mine.data?.["myWorkspaces"]).toEqual([
      {
        id: a.id,
        settings: { trashDays: 30, versionsMax: 20, versionsDays: 90 },
      },
    ]);
  });
});
