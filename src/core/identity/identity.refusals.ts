export const codeOf = (error: unknown) =>
  (error as { extensions?: { code?: string } }).extensions?.code;

export const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as { extensions: Record<string, unknown> };
  }
  throw new Error("not refused");
};
