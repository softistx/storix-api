import { beforeAll, describe, expect, test } from "bun:test";
import { migrate } from "@softistx/mongo/migrations";
import { createApp } from "@/app";
import { connection, core } from "@/config/db";
import { env } from "@/config/env";
import { migrations } from "@/config/migrations";
import { clientHeader } from "@/http/csrf";
import { errorCodes } from "@/i18n/codes";
import { loadTranslations } from "./translations.load";

interface Catalogue {
  language: string;
  version: string;
  messages: { code: string; message: string }[];
}

const app = createApp();
const ask = async (query: string, headers: Record<string, string> = {}) => {
  const response = await app.fetch(
    new Request("http://localhost/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [clientHeader]: "spec",
        ...headers,
      },
      body: JSON.stringify({ query }),
    }),
  );
  return (await response.json()) as {
    data: { errorCatalogue: Catalogue; en: Catalogue; fr: Catalogue };
    errors?: unknown[];
  };
};

beforeAll(async () => {
  await migrate(connection.client.db(env.MONGO_CORE_DATABASE), [...migrations]);
  await loadTranslations(core);
});

describe("Query.errorCatalogue", () => {
  test("serves every code in the asked language, with a version", async () => {
    const { data, errors } = await ask(
      "{ errorCatalogue(language: FR) { language version messages { code message } } }",
    );
    expect(errors).toBeUndefined();
    expect(data.errorCatalogue.language).toBe("FR");
    expect(data.errorCatalogue.version).toMatch(/^[0-9a-f]{32}$/);
    expect(
      data.errorCatalogue.messages.map((m: { code: string }) => m.code),
    ).toEqual([...errorCodes]);
    expect(data.errorCatalogue.messages[1]).toEqual({
      code: "auth.errors.forbidden",
      message: "Vous n’avez pas le droit de faire cela.",
    });
  });

  test("defaults to the request's language", async () => {
    const french = await ask("{ errorCatalogue { language } }", {
      "accept-language": "fr",
    });
    expect(french.data.errorCatalogue.language).toBe("FR");
    const none = await ask("{ errorCatalogue { language } }");
    expect(none.data.errorCatalogue.language).toBe("EN");
  });

  test("the two languages have their own versions", async () => {
    const { data } = await ask(
      "{ en: errorCatalogue(language: EN) { version } fr: errorCatalogue(language: FR) { version } }",
    );
    expect(data.en.version).not.toBe(data.fr.version);
  });
});
