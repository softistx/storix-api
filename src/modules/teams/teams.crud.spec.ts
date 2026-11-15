import { describe, expect, test } from "bun:test";
import { world } from "../../../test/workspaces.harness";

const TEAM = "id name memberIds memberCount";
const CREATE = `mutation($name: String!) { createTeam(name: $name) { ${TEAM} } }`;
const RENAME = `mutation($id: ID!, $name: String!) { renameTeam(id: $id, name: $name) { ${TEAM} } }`;
const SET = `mutation($id: ID!, $ids: [ID!]!) { setTeamMembers(id: $id, memberIds: $ids) { ${TEAM} } }`;
const DELETE = "mutation($id: ID!) { deleteTeam(id: $id) }";
const LIST = `{ teams { ${TEAM} } }`;
const ONE = `query($id: ID!) { team(id: $id) { ${TEAM} } }`;

async function setup() {
  const w = await world();
  const workspace = await w.workspaceOf();
  const at = { workspace: workspace.id };
  const create = async (name: string) => {
    const result = await w.send(workspace.owner, CREATE, {
      ...at,
      variables: { name },
    });
    return result;
  };
  return { w, workspace, at, create };
}

describe("teams: create, list, rename, delete", () => {
  test("a team is created empty, listed by name, read and deleted", async () => {
    const { w, workspace, at, create } = await setup();
    const zeta = await create("Zeta");
    const alpha = await create("alpha");
    expect(zeta.errors).toBeUndefined();
    expect(zeta.data?.["createTeam"]).toMatchObject({
      name: "Zeta",
      memberIds: [],
      memberCount: 0,
    });
    const list = await w.send(workspace.owner, LIST, at);
    expect(list.data?.["teams"].map((t: { name: string }) => t.name)).toEqual([
      "alpha",
      "Zeta",
    ]);
    const id = alpha.data?.["createTeam"].id;
    const one = await w.send(workspace.owner, ONE, {
      ...at,
      variables: { id },
    });
    expect(one.data?.["team"].name).toBe("alpha");
    const gone = await w.send(workspace.owner, DELETE, {
      ...at,
      variables: { id },
    });
    expect(gone.data?.["deleteTeam"]).toBe(true);
    const after = await w.send(workspace.owner, ONE, {
      ...at,
      variables: { id },
    });
    expect(w.codeOf(after)).toBe("teams.errors.not-found");
    expect(after.response.status).toBe(404);
  });

  test("a name is trimmed and a blank one is refused", async () => {
    const { w, create } = await setup();
    const trimmed = await create("  Design  ");
    expect(trimmed.data?.["createTeam"].name).toBe("Design");
    const blank = await create("   ");
    expect(w.codeOf(blank)).toBe("validation.errors.invalid-input");
  });

  test("a name is unique in the workspace, ignoring case", async () => {
    const { w, workspace, at, create } = await setup();
    await create("Design");
    for (const name of ["design", "DESIGN", " Design "]) {
      const taken = await create(name);
      expect(w.codeOf(taken)).toBe("teams.errors.name-taken");
      expect(taken.response.status).toBe(409);
    }
    const other = await create("Sales");
    // Renaming onto another team's name, in any case, is refused ...
    const clash = await w.send(workspace.owner, RENAME, {
      ...at,
      variables: { id: other.data?.["createTeam"].id, name: "dEsIgN" },
    });
    expect(w.codeOf(clash)).toBe("teams.errors.name-taken");
    // ... but the team's own name in another case is a rename.
    const recase = await w.send(workspace.owner, RENAME, {
      ...at,
      variables: { id: other.data?.["createTeam"].id, name: "SALES" },
    });
    expect(recase.errors).toBeUndefined();
    expect(recase.data?.["renameTeam"].name).toBe("SALES");
  });

  test("the same name is free in another workspace", async () => {
    const { create } = await setup();
    await create("Design");
    const other = await setup();
    const result = await other.create("Design");
    expect(result.errors).toBeUndefined();
  });

  test("a deleted team's name is free again", async () => {
    const { w, workspace, at, create } = await setup();
    const made = await create("Design");
    await w.send(workspace.owner, DELETE, {
      ...at,
      variables: { id: made.data?.["createTeam"].id },
    });
    expect((await create("design")).errors).toBeUndefined();
  });

  test("an unknown or malformed id is a 404", async () => {
    const { w, workspace, at } = await setup();
    for (const id of ["000000000000000000000000", "nope"]) {
      for (const [query, variables] of [
        [ONE, { id }],
        [RENAME, { id, name: "x" }],
        [SET, { id, ids: [] }],
        [DELETE, { id }],
      ] as const) {
        const result = await w.send(workspace.owner, query, {
          ...at,
          variables,
        });
        expect(w.codeOf(result)).toBe("teams.errors.not-found");
        expect(result.response.status).toBe(404);
      }
    }
  });
});
