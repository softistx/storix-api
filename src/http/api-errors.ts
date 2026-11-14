import { invalidInputOf } from "@nxgt/graphql-validation";
import type { Plugin } from "graphql-yoga";
import { translate } from "../i18n/fail";

// A Yoga plugin: @constraint refusals leave as every other invalid input does,
// `validation.errors.invalid-input` with `extensions.fields` (the refusal
// converted by @nxgt/graphql-validation's `invalidInputOf`, messages
// translated). It rewrites the execution's result rather than masking, since
// Yoga logs as an error every error a `maskError` replaces.
export const apiErrors: Plugin = {
  onExecute: () => ({
    onExecuteDone: ({ result, setResult }) => {
      if (!("errors" in result) || !result.errors) return;
      const changed = result.errors.map((error) =>
        invalidInputOf(error, { translate }),
      );
      if (changed.every((error, i) => error === result.errors?.[i])) return;
      setResult({ ...result, errors: changed });
    },
  }),
};
