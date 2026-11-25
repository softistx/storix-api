// The notification mails: the subject and body come from the translations
// (`notifications.mail.<what>.subject` and `.body`, in the recipient's
// language), the HTML is the body escaped, one paragraph per line.

export type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

export type MailContent = { subject: string; text: string; html: string };

export type MailKind = "shared" | "role-changed" | "quota";

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function mailOf(
  kind: MailKind,
  params: Record<string, string | number>,
  translate: Translate,
): MailContent {
  // A role is worded in the recipient's language (`notifications.mail.role.*`).
  const worded =
    typeof params["role"] === "string"
      ? {
          ...params,
          role: translate(
            `notifications.mail.role.${params["role"].toLowerCase()}`,
          ),
        }
      : params;
  const text = translate(`notifications.mail.${kind}.body`, worded);
  const html = text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
  return {
    subject: translate(`notifications.mail.${kind}.subject`, worded),
    text,
    html: html === "" ? "<p></p>" : html,
  };
}
