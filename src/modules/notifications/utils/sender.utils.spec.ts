import { describe, expect, test } from "bun:test";
import { createMemoryMailer } from "@softistx/mail";
import { directSender, mailsHandler, queuedSender } from "./sender.utils";

const mail = { to: "a@storix.test", subject: "S", text: "T", html: "<p>T</p>" };

describe("the senders of a prepared mail", () => {
  test("the queued sender adds the job under the notification's id", async () => {
    const added: unknown[] = [];
    await queuedSender({
      add: (job, options) => added.push({ job, options }),
    })(mail, "notification-1");
    expect(added).toEqual([{ job: mail, options: { id: "notification-1" } }]);
  });

  test("the direct sender mails from the product address, with the id as key", async () => {
    const mailer = createMemoryMailer();
    await directSender(mailer, "noreply@storix.test")(mail, "notification-2");
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({
      to: "a@storix.test",
      subject: "S",
      idempotencyKey: "notification-2",
    });
  });

  test("the worker's handler sends the job's mail", async () => {
    const mailer = createMemoryMailer();
    await mailsHandler(
      mailer,
      "noreply@storix.test",
    )({
      data: mail,
      id: "notification-3",
    } as never);
    expect(mailer.sent[0]?.subject).toBe("S");
  });

  test("a mailer that fails makes the handler throw, so the queue retries", async () => {
    const failing = {
      send: async () => {
        throw new Error("smtp down");
      },
    } as never;
    await expect(
      mailsHandler(
        failing,
        "noreply@storix.test",
      )({
        data: mail,
        id: "n",
      } as never),
    ).rejects.toThrow("smtp down");
  });
});
