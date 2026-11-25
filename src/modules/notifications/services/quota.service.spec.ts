import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { tenancy } from "@/config/tenancy";
import { world } from "../../../../test/workspaces.harness";
import { notificationsMongo } from "../models";
import { claimLevel } from "./quota.service";

const mongo = () => notificationsMongo(tenancy.core);
const fresh = () => new ObjectId().toHexString();

describe("claiming a quota level", () => {
  test("the first crossing of a level wins, a second one is told already", async () => {
    await world();
    const id = fresh();
    expect(await claimLevel(mongo(), id, 80)).toBe(true);
    expect(await claimLevel(mongo(), id, 80)).toBe(false);
  });

  test("a higher level is claimed on top of a lower one, never the reverse", async () => {
    await world();
    const id = fresh();
    expect(await claimLevel(mongo(), id, 80)).toBe(true);
    expect(await claimLevel(mongo(), id, 100)).toBe(true);
    expect(await claimLevel(mongo(), id, 100)).toBe(false);
    expect(await claimLevel(mongo(), id, 80)).toBe(false);
  });

  test("a jump straight to 100 is one claim", async () => {
    await world();
    const id = fresh();
    expect(await claimLevel(mongo(), id, 100)).toBe(true);
    expect(await claimLevel(mongo(), id, 100)).toBe(false);
  });

  test("usage seen under a level re-arms it for the next crossing", async () => {
    await world();
    const id = fresh();
    await claimLevel(mongo(), id, 100);
    expect(await claimLevel(mongo(), id, 0)).toBe(false);
    expect(await claimLevel(mongo(), id, 80)).toBe(true);
    expect(await claimLevel(mongo(), id, 100)).toBe(true);
  });

  test("usage that dropped to 80 re-arms 100 but not 80", async () => {
    await world();
    const id = fresh();
    await claimLevel(mongo(), id, 100);
    expect(await claimLevel(mongo(), id, 80)).toBe(false);
    expect(await claimLevel(mongo(), id, 100)).toBe(true);
  });

  test("racing claims of one level give exactly one winner", async () => {
    await world();
    const id = fresh();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => claimLevel(mongo(), id, 80)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
