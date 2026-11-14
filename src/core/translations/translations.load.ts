import type { ModuleCoreHandle } from "@alxia/modules";
import type { core } from "@/config/db";
import { FALLBACK_LANGUAGE, i18n, type Language } from "@/i18n";
import { errorCodes } from "@/i18n/codes";
import { missingMessages } from "@/i18n/missing-messages";
import {
  catalogueOf,
  type ErrorMessageView,
  messagesOf,
  type Row,
  type Tree,
  versionOf,
} from "./translations.catalogue";

// The module's handle on the core database: its own collection only.
export type TranslationsMongo = ModuleCoreHandle<"translations", typeof core>;

interface Served {
  messages: ErrorMessageView[];
  version: string;
}

// What `errorCatalogue` serves per language, built by `loadTranslations`:
// every code's message (each missing one filled from the fallback language)
// and the version of the chain. In memory: a request reads nothing.
const served = new Map<string, Served>();
let loaded = false;

// What `Query.errorCatalogue` resolves to: the language and its version;
// `messages` is read when selected.
export interface CatalogueView {
  language: string;
  version: string;
}

export const catalogueOfLanguage = (language: string): CatalogueView => {
  const entry = servedOf(language);
  return { language, version: entry.version };
};

export const errorMessages = (language: string): ErrorMessageView[] =>
  servedOf(language).messages;

function servedOf(language: string): Served {
  if (!loaded) throw new Error("the translations are not loaded");
  const entry = served.get(language);
  if (entry === undefined) throw new RangeError(`no language "${language}"`);
  return entry;
}

// Whether `loadTranslations` has run.
export const translationsLoaded = () => loaded;

// Builds what is served from the rows (a pure step, specs use it directly):
// one catalogue per language the rows hold, the fallback's the last step of
// every chain, and the version of each chain.
export function buildServed(
  rows: readonly Row[],
  codes: readonly string[] = errorCodes,
): { trees: Record<string, Tree>; served: Map<string, Served> } {
  const languages = [...new Set(rows.map((row) => row.language))].sort();
  const trees = Object.fromEntries(
    languages.map((language) => [language, catalogueOf(rows, language)]),
  );
  const fallback = trees[FALLBACK_LANGUAGE];
  const built = new Map<string, Served>();
  for (const language of languages) {
    const own = trees[language] as Tree;
    const chain =
      fallback && language !== FALLBACK_LANGUAGE ? [own, fallback] : [own];
    built.set(language, {
      messages: messagesOf(chain, codes),
      version: versionOf(chain),
    });
  }
  return { trees, served: built };
}

// Reads the translations once, at startup, and gives them to @alxia/i18n
// (`setResources`, atomic: a request in flight keeps its snapshot) and to what
// `errorCatalogue` serves. The texts change by migration, which comes with a
// restart, so there is no reload. The fallback language must have rows.
export async function loadTranslations(
  mongo: TranslationsMongo,
): Promise<void> {
  const rows = (await mongo.db.translations.raw.find({}).toArray()).map(
    ({ code, language, text }) => ({ code, language, text }),
  );
  const built = buildServed(rows);
  if (!built.trees[FALLBACK_LANGUAGE]) {
    throw new Error(
      `no translations in the fallback language "${FALLBACK_LANGUAGE}"`,
    );
  }
  const missing = missingMessages(errorCodes, rows, [FALLBACK_LANGUAGE]);
  if (missing.length > 0) {
    throw new Error(
      `translations: no fallback-language text for ${missing.join(", ")}`,
    );
  }
  i18n.setResources(built.trees as Record<Language, never>);
  served.clear();
  for (const [language, entry] of built.served) served.set(language, entry);
  loaded = true;
}
