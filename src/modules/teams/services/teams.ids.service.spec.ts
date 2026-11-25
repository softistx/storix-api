import { describe, expect, test } from "bun:test";
import { store } from "@/config/tenancy";
import { world } from "../../../../test/workspaces.harness";
import { teamsMongo } from "../models";
import {
  createTeam,
  findTeam,
  getTeam,
  teamIdsOfMember,
} from "./teams.service";

describe("teamIdsOfMember", () => {
  test("lists the teams a member belongs to, none for a member of no team", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    const inBoth = await w.join(workspace, "MEMBER");
    const inOne = await w.join(workspace, "MEMBER");
    const alone = await w.join(workspace, "MEMBER");
    const mongo = teamsMongo(await store.databaseOf(workspace.id));
    const team = async (name: string, memberIds: string[]) => {
      const made = await createTeam(mongo, name, "seed");
      await mongo.db.teams.update(made._id, { memberIds: memberIds as never });
      return made.id;
    };
    const first = await team("One", [inBoth.memberId, inOne.memberId]);
    const second = await team("Two", [inBoth.memberId]);
    const ids = async (memberId: string) =>
      (await teamIdsOfMember(mongo, memberId))
        .map((id) => id.toHexString())
        .sort();
    expect(await ids(inBoth.memberId)).toEqual([first, second].sort());
    expect(await ids(inOne.memberId)).toEqual([first]);
    expect(await ids(alone.memberId)).toEqual([]);
  });
});

describe("findTeam", () => {
  test("answers the team, or undefined for a malformed or unknown id", async () => {
    const w = await world();
    const workspace = await w.workspaceOf();
    const mongo = teamsMongo(await store.databaseOf(workspace.id));
    const made = await createTeam(mongo, "Crew", "seed");
    expect((await findTeam(mongo, made.id))?.name).toBe("Crew");
    expect(await findTeam(mongo, "6563f8f0a1b2c3d4e5f60700")).toBeUndefined();
    expect(await findTeam(mongo, "nope")).toBeUndefined();
    expect(getTeam(mongo, "nope")).rejects.toMatchObject({
      extensions: { code: "teams.errors.not-found" },
    });
  });
});
