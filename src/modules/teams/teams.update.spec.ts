import { describe, expect, test } from "bun:test";
import { world } from "../../../test/workspaces.harness";

const TEAM = "id name memberIds memberCount";
const CREATE = `mutation($name: String!) { createTeam(name: $name) { ${TEAM} } }`;
const UPDATE = `mutation($id: ID!, $input: UpdateTeamInput!) { updateTeam(id: $id, input: $input) { ${TEAM} } }`;
const ONE = `query($id: ID!) { team(id: $id) { ${TEAM} } }`;

async function setup() {
  const w = await world();
  const workspace = await w.workspaceOf();
  const at = { workspace: workspace.id };
  const create = async (name: string) =>
    (await w.send(workspace.owner, CREATE, { ...at, variables: { name } }))
      .data?.["createTeam"].id as string;
  const teamId = await create("Design");
  const update = (input: object, id = teamId) =>
    w.send(workspace.owner, UPDATE, { ...at, variables: { id, input } });
  const read = async (id = teamId) =>
    (await w.send(workspace.owner, ONE, { ...at, variables: { id } })).data?.[
      "team"
    ];
  return { w, workspace, create, update, read, teamId };
}

describe("updateTeam", () => {
  test("changes the name and the members together", async () => {
    const { w, workspace, update, read } = await setup();
    const a = await w.join(workspace, "MEMBER");
    const result = await update({
      name: "  Product ",
      memberIds: [a.memberId, a.memberId],
    });
    expect(result.errors).toBeUndefined();
    expect(result.data?.["updateTeam"]).toMatchObject({
      name: "Product",
      memberIds: [a.memberId],
      memberCount: 1,
    });
    expect(await read()).toMatchObject({
      name: "Product",
      memberIds: [a.memberId],
    });
  });

  test("keeps what is left out", async () => {
    const { w, workspace, update, read } = await setup();
    const a = await w.join(workspace, "MEMBER");
    await update({ memberIds: [a.memberId] });
    await update({ name: "Renamed" });
    expect(await read()).toMatchObject({
      name: "Renamed",
      memberIds: [a.memberId],
    });
    await update({ memberIds: [] });
    expect(await read()).toMatchObject({ name: "Renamed", memberIds: [] });
  });

  test("a duplicate name changes neither the name nor the members", async () => {
    const { w, workspace, create, update, read } = await setup();
    const a = await w.join(workspace, "MEMBER");
    const b = await w.join(workspace, "MEMBER");
    await update({ memberIds: [a.memberId] });
    await create("Taken");
    const result = await update({ name: "taken", memberIds: [b.memberId] });
    expect(w.codeOf(result)).toBe("teams.errors.name-taken");
    expect(result.response.status).toBe(409);
    expect(await read()).toMatchObject({
      name: "Design",
      memberIds: [a.memberId],
    });
  });

  test("an unknown member changes neither the name nor the members", async () => {
    const { w, workspace, update, read } = await setup();
    const a = await w.join(workspace, "MEMBER");
    await update({ memberIds: [a.memberId] });
    const result = await update({
      name: "Other",
      memberIds: [a.memberId, "000000000000000000000000"],
    });
    expect(w.codeOf(result)).toBe("teams.errors.member-unknown");
    expect(await read()).toMatchObject({
      name: "Design",
      memberIds: [a.memberId],
    });
  });

  test("an unknown team is 404", async () => {
    const { w, update } = await setup();
    const result = await update({ name: "X" }, "000000000000000000000000");
    expect(w.codeOf(result)).toBe("teams.errors.not-found");
  });
});
