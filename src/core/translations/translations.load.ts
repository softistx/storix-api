import {
  assertCoverage,
  catalogueOf,
  type MessageView,
  resolveCatalogue,
  type TextRow,
  type Tree,
} from "@alxia/i18n";
import type { ModuleCoreHandle } from "@alxia/modules";
import type { core } from "@/config/db";
import { FALLBACK_LANGUAGE, i18n, type Language } from "@/i18n";
import { errorCodes } from "@/i18n/codes";

// The module's handle on the core database: its own collection only.
export type TranslationsMongo = ModuleCoreHandle<"translations", typeof core>;

interface Served {
  messages: MessageView[];
  version: string;
}

// What `Query.errorCatalogue` resolves to: the language and its version;
// `messages` is read when selected.
export interface CatalogueView {
  language: string;
  version: string;
}

// What `errorCatalogue` serves per language, built by `loadTranslations`:
// every code's message (each missing one filled from the fallback language)
// and the version of the chain. In memory: a request reads nothing. The app
// holds it and hands it to the requests (`ctx.translations`).
export interface Translations {
  catalogueOfLanguage(language: string): CatalogueView;
  errorMessages(language: string): MessageView[];
}

export function translationsOf(
  served: ReadonlyMap<string, Served>,
): Translations {
  const servedOf = (language: string): Served => {
    const entry = served.get(language);
    if (entry === undefined) throw new RangeError(`no language "${language}"`);
    return entry;
  };
  return {
    catalogueOfLanguage: (language) => ({
      language,
      version: servedOf(language).version,
    }),
    errorMessages: (language) => servedOf(language).messages,
  };
}

// Builds what is served from the rows (a pure step, specs use it directly):
// one catalogue per language the rows hold, the fallback's the last step of
// every chain, and the version of each chain.
export function buildServed(
  rows: readonly TextRow[],
  codes: readonly string[] = errorCodes,
): { trees: Record<string, Tree>; served: Map<string, Served> } {
  const languages = [...new Set(rows.map((row) => row.language))].sort();
  const hasFallback = languages.includes(FALLBACK_LANGUAGE);
  const trees: Record<string, Tree> = {};
  const built = new Map<string, Served>();
  for (const language of languages) {
    const chain: [string, ...string[]] =
      hasFallback && language !== FALLBACK_LANGUAGE
        ? [language, FALLBACK_LANGUAGE]
        : [language];
    const resolved = resolveCatalogue(rows, chain);
    trees[language] = resolved.chain[0] as Tree;
    built.set(language, {
      messages: resolved.messages(codes),
      version: resolved.version,
    });
  }
  return { trees, served: built };
}

// Reads the translations once, at startup, and gives them to @alxia/i18n
// (`setResources`, atomic: a request in flight keeps its snapshot) and to what
// `errorCatalogue` serves, which it returns. The texts change by migration,
// which comes with a restart, so there is no reload. The fallback language must
// have rows.
export async function loadTranslations(
  mongo: TranslationsMongo,
): Promise<Translations> {
  const rows = (await mongo.db.translations.raw.find({}).toArray()).map(
    ({ code, language, text }): TextRow => ({ key: code, language, text }),
  );
  const built = buildServed(rows);
  if (!built.trees[FALLBACK_LANGUAGE]) {
    throw new Error(
      `no translations in the fallback language "${FALLBACK_LANGUAGE}"`,
    );
  }
  assertCoverage(errorCodes, catalogueOf(rows, FALLBACK_LANGUAGE), {
    language: FALLBACK_LANGUAGE,
  });
  i18n.setResources(built.trees as Record<Language, never>);
  return translationsOf(built.served);
}
