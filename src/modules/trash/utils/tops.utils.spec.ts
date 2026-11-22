import { describe, expect, test } from "bun:test";
import type { NodeDoc } from "@/modules/nodes/public";
import { topsOf } from "./tops.utils";

const at = (hex: string) => ({ toHexString: () => hex });
const node = (id: string, ancestors: string[]) =>
  ({ id, ancestors: ancestors.map(at) }) as unknown as NodeDoc;

describe("topsOf", () => {
  test("drops an entry that sits under another selected one", () => {
    const folder = node("a", []);
    const inside = node("b", ["a"]);
    const apart = node("c", ["z"]);
    expect(topsOf([folder, inside, apart])).toEqual([folder, apart]);
  });

  test("keeps everything when nothing contains anything", () => {
    const list = [node("a", []), node("b", [])];
    expect(topsOf(list)).toEqual(list);
  });
});
