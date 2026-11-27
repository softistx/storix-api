/**
 * The backup settings of the env file, checked by deploy.ts before anything is
 * built, and the offsite prefix check restore.ts shares. Kept apart from lib.ts
 * (the stack plumbing) and from backup/ (the shell scripts of the image).
 */

/**
 * Why `prefix` cannot be an offsite folder (BACKUP_S3_PREFIX, --from-prefix), or
 * undefined: a plain path of letters, digits, `.`, `_`, `-` segments, none of
 * them `.` or `..`.
 */
export function prefixProblem(prefix: string): string | undefined {
  if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(prefix))
    return `'${prefix}' is not a plain path (letters, digits, . _ - and / between segments)`;
  if (prefix.split("/").some((part) => part === "." || part === ".."))
    return `'${prefix}' must not contain a . or .. segment`;
  return undefined;
}

/** The offsite settings the `backup` service cannot start without. */
export const BACKUP_REQUIRED = [
  "BACKUP_S3_ENDPOINT",
  "BACKUP_S3_BUCKET",
  "BACKUP_S3_ACCESS_KEY",
  "BACKUP_S3_SECRET_KEY",
] as const;

/**
 * What is wrong with the env file's backup settings, one message each: a
 * missing or CHANGE_ME BACKUP_S3_* or MONGO_BACKUP_PASSWORD (the user with the
 * `backup` role that takes the dump), an endpoint that is not an http(s) URL, a
 * BACKUP_HOUR outside 00 to 23 (backup-loop refuses it and the container would
 * restart in a loop), a BACKUP_RETENTION_DAYS that is not a positive number, a
 * BACKUP_S3_PREFIX that is not a plain path. Empty when it is fine.
 */
export function backupProblems(values: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const name of BACKUP_REQUIRED) {
    const value = values[name];
    if (value === undefined || value === "" || value === "CHANGE_ME")
      problems.push(`${name} is required (the offsite bucket of the backups)`);
  }
  const password = values["MONGO_BACKUP_PASSWORD"];
  if (password === undefined || password === "" || password === "CHANGE_ME")
    problems.push(
      "MONGO_BACKUP_PASSWORD is required (the password of the Mongo user with the backup role)",
    );
  else if (!/^[A-Za-z0-9._~-]+$/.test(password))
    problems.push(
      "MONGO_BACKUP_PASSWORD must use letters, digits, . _ ~ - only (it sits in a URL): openssl rand -hex 24",
    );
  const endpoint = values["BACKUP_S3_ENDPOINT"];
  if (
    endpoint &&
    endpoint !== "CHANGE_ME" &&
    !/^https?:\/\/[^\s/]+/.test(endpoint)
  )
    problems.push("BACKUP_S3_ENDPOINT must be an http:// or https:// URL");
  const hour = values["BACKUP_HOUR"];
  if (hour !== undefined && hour !== "" && !/^([01][0-9]|2[0-3])$/.test(hour))
    problems.push(`BACKUP_HOUR must be two digits, 00 to 23 (got '${hour}')`);
  const days = values["BACKUP_RETENTION_DAYS"];
  if (days !== undefined && days !== "" && !/^[1-9][0-9]*$/.test(days))
    problems.push("BACKUP_RETENTION_DAYS must be a positive number of days");
  const prefix = values["BACKUP_S3_PREFIX"];
  if (prefix !== undefined && prefix !== "") {
    const problem = prefixProblem(prefix);
    if (problem) problems.push(`BACKUP_S3_PREFIX ${problem}`);
  }
  return problems;
}
