import { JanusError } from "@softistx/janus";
import { type Deps, localeOf } from "./janus.shared";

// What follows the insert, in the background, the same for both answers so
// that neither the result nor its time tells whether the address was taken.
// A taken address is sent a fresh verification link when its account is not
// proved yet (in the language of its account), else the "someone tried to sign up with your address" notice.
export function signUpFollowUp(
  deps: Pick<Deps, "accounts" | "mail" | "background">,
  email: string,
  taken: boolean,
) {
  const { accounts, mail, background } = deps;
  const users = accounts.user;
  background.run("a sign-up follow-up", async () => {
    try {
      // Spends the per-address mail count either way, as a reset does.
      await users.resetPassword.prepare(email);
      if (!taken) return;
      const owner = await users.findByEmail(email);
      if (!owner) return;
      if (!owner.emailVerified) {
        const issued = await users.verifyEmail.send(owner);
        await mail.verifyEmail(issued, {
          name: owner.email,
          locale: localeOf(owner),
        });
        return;
      }
      await mail.signUpAttempted({
        name: owner.name,
        email: owner.email,
        locale: localeOf(owner),
      });
    } catch (error) {
      if (error instanceof JanusError) return;
      throw error;
    }
  });
}
