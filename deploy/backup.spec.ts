import { describe, expect, test } from "bun:test";
import { backupProblems, prefixProblem } from "./backup";

describe("backupProblems", () => {
  const ok = {
    BACKUP_S3_ENDPOINT: "https://s3.example.com",
    BACKUP_S3_BUCKET: "storix-backup",
    BACKUP_S3_ACCESS_KEY: "key",
    BACKUP_S3_SECRET_KEY: "secret",
    MONGO_BACKUP_PASSWORD: "0123abcd",
  };
  test("a complete set, with or without the optional ones, is fine", () => {
    expect(backupProblems(ok)).toEqual([]);
    expect(
      backupProblems({
        ...ok,
        BACKUP_HOUR: "00",
        BACKUP_RETENTION_DAYS: "7",
        BACKUP_S3_PREFIX: "storix-demo/a",
      }),
    ).toEqual([]);
  });
  test("each missing, empty or CHANGE_ME BACKUP_S3_* is named", () => {
    expect(backupProblems({})).toHaveLength(5);
    const problems = backupProblems({
      ...ok,
      BACKUP_S3_BUCKET: "",
      BACKUP_S3_SECRET_KEY: "CHANGE_ME",
    });
    expect(problems).toHaveLength(2);
    expect(problems.join()).toContain("BACKUP_S3_BUCKET");
    expect(problems.join()).toContain("BACKUP_S3_SECRET_KEY");
  });
  test("MONGO_BACKUP_PASSWORD is required and must be URL safe", () => {
    const { MONGO_BACKUP_PASSWORD: _, ...without } = ok;
    expect(backupProblems(without)).toEqual([
      "MONGO_BACKUP_PASSWORD is required (the password of the Mongo user with the backup role)",
    ]);
    expect(
      backupProblems({ ...ok, MONGO_BACKUP_PASSWORD: "CHANGE_ME" }),
    ).toHaveLength(1);
    expect(backupProblems({ ...ok, MONGO_BACKUP_PASSWORD: "a@b/c" })).toEqual([
      "MONGO_BACKUP_PASSWORD must use letters, digits, . _ ~ - only (it sits in a URL): openssl rand -hex 24",
    ]);
  });
  test("the endpoint must be an http(s) URL", () => {
    expect(
      backupProblems({ ...ok, BACKUP_S3_ENDPOINT: "s3.example.com" }),
    ).toEqual(["BACKUP_S3_ENDPOINT must be an http:// or https:// URL"]);
  });
  test("BACKUP_HOUR is 00 to 23, two digits", () => {
    for (const h of ["00", "03", "19", "23"])
      expect(backupProblems({ ...ok, BACKUP_HOUR: h })).toEqual([]);
    for (const h of ["24", "3", "-1", "ab", "003"])
      expect(backupProblems({ ...ok, BACKUP_HOUR: h })).toHaveLength(1);
  });
  test("retention is a positive number and the prefix a plain path", () => {
    expect(backupProblems({ ...ok, BACKUP_RETENTION_DAYS: "0" })).toHaveLength(
      1,
    );
    expect(backupProblems({ ...ok, BACKUP_RETENTION_DAYS: "x" })).toHaveLength(
      1,
    );
    expect(backupProblems({ ...ok, BACKUP_S3_PREFIX: "a b" })).toHaveLength(1);
    expect(backupProblems({ ...ok, BACKUP_S3_PREFIX: "../x" })).toHaveLength(1);
    expect(backupProblems({ ...ok, BACKUP_S3_PREFIX: "a/./b" })).toHaveLength(
      1,
    );
  });
});

describe("prefixProblem", () => {
  test("accepts plain paths, refuses spaces, empty segments, . and ..", () => {
    for (const p of ["storix", "storix-demo", "a/b.c_d"])
      expect(prefixProblem(p)).toBeUndefined();
    for (const p of ["", "a b", "/a", "a//b", "a/", ".", "..", "a/../b"])
      expect(prefixProblem(p)).toBeDefined();
  });
});
