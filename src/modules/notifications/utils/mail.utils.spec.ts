import { describe, expect, test } from "bun:test";
import { escapeHtml, mailOf } from "./mail.utils";

describe("the notification mails", () => {
  test("the subject and the body come from the translations of the kind", () => {
    const asked: string[] = [];
    const mail = mailOf("shared", { actor: "Ada", node: "Docs" }, (key) => {
      asked.push(key);
      return `text of ${key}`;
    });
    expect(asked.sort()).toEqual([
      "notifications.mail.shared.body",
      "notifications.mail.shared.subject",
    ]);
    expect(mail.subject).toBe("text of notifications.mail.shared.subject");
    expect(mail.text).toBe("text of notifications.mail.shared.body");
  });

  test("a role is worded in the recipient's language before it reaches the text", () => {
    const seen: unknown[] = [];
    mailOf("shared", { role: "EDITOR" }, (key, params) => {
      seen.push(key.endsWith("body") ? params?.["role"] : key);
      return key === "notifications.mail.role.editor" ? "éditeur" : key;
    });
    expect(seen).toContain("éditeur");
  });

  test("the params reach the translation", () => {
    const seen: unknown[] = [];
    mailOf("quota", { workspace: "W", percent: 85 }, (_, params) => {
      seen.push(params);
      return "x";
    });
    expect(seen[0]).toEqual({ workspace: "W", percent: 85 });
  });

  test("the html is the body escaped, one paragraph per line", () => {
    const mail = mailOf("role-changed", {}, (key) =>
      key.endsWith("body") ? "a <b> & c\n\nsecond" : "s",
    );
    expect(mail.html).toBe("<p>a &lt;b&gt; &amp; c</p><p>second</p>");
  });

  test("an empty body still gives a paragraph", () => {
    expect(mailOf("quota", {}, () => "").html).toBe("<p></p>");
  });

  test("escapeHtml escapes the five characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
