import type { Context } from "@/http/context";
import type { Translations } from "./translations.load";

// The translations `boot` loaded, which the app hands to every request.
export function loaded(ctx: Context): Translations {
  if (!ctx.translations) throw new Error("the translations are not loaded");
  return ctx.translations;
}

export const languageValue = (code: string) => (code === "fr" ? "FR" : "EN");

// The error catalogue is public: no guard. `version` and `language` read
// nothing; `messages` is its own field, so a query that selects only `version`
// builds no list.
