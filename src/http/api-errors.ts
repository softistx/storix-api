import { definePlugin } from "@graxia/core";
import { invalidInputOf } from "@nxgt/graphql-validation";
import { translate } from "../i18n/fail";

// A graxia plugin: @constraint refusals leave as every other invalid input
// does, `validation.errors.invalid-input` with `extensions.fields` (the refusal
// converted by @nxgt/graphql-validation's `invalidInputOf`, messages
// translated). It rewrites the execution's result rather than masking.
export const apiErrors = definePlugin({
  name: "storix-api-errors",
  onExecute:
    () =>
    ({ result, setResult }) => {
      if (!result || !("errors" in result) || !result.errors) return;
      const changed = result.errors.map((error) =>
        invalidInputOf(error, { translate }),
      );
      if (changed.every((error, i) => error === result.errors?.[i])) return;
      setResult({ ...result, errors: changed });
    },
});
