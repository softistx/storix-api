import { describe, expect, test } from "bun:test";
import { world } from "../../../test/workspaces.harness";

describe("/media without a bucket", () => {
  test("answers 503 storage.errors.unavailable in the error shape", async () => {
    const w = await world({ media: { bucket: undefined } });
    const ws = await w.workspaceOf();
    const res = await w.h.app.fetch(
      new Request("http://localhost/media/files", {
        method: "PUT",
        body: "x",
        headers: {
          ...ws.owner.headers,
          "x-storix-workspace": ws.id,
          "content-type": "text/plain",
        },
      }),
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      errors: { extensions: { code: string } }[];
    };
    expect(body.errors[0]?.extensions.code).toBe("storage.errors.unavailable");
  });
});
