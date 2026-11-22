import type { fileFamilies } from "../models";

export type FileFamily = (typeof fileFamilies)[number];

const SPREADSHEETS = new Set([
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.oasis.opendocument.spreadsheet",
]);
const PRESENTATIONS = new Set([
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.presentation",
]);
const DOCUMENTS = new Set([
  "application/msword",
  "application/rtf",
  "application/vnd.oasis.opendocument.text",
  "text/plain",
  "text/markdown",
  "text/rtf",
]);
const ARCHIVES = new Set([
  "application/zip",
  "application/gzip",
  "application/x-gzip",
  "application/x-tar",
  "application/x-7z-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
  "application/x-bzip2",
]);
const CODE = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-sh",
  "application/x-yaml",
  "application/yaml",
  "application/sql",
]);

// What a file is, from the content type the storage reported (parameters
// ignored, case ignored): the filter and the "kind" sort of a listing.
export function familyOf(mimeType: string): FileFamily {
  const type = (mimeType.split(";")[0] ?? "").trim().toLowerCase();
  if (type === "application/pdf") return "PDF";
  if (type.startsWith("image/")) return "IMAGE";
  if (type.startsWith("video/")) return "VIDEO";
  if (type.startsWith("audio/")) return "AUDIO";
  if (SPREADSHEETS.has(type) || type.includes("spreadsheetml")) {
    return "SPREADSHEET";
  }
  if (PRESENTATIONS.has(type) || type.includes("presentationml")) {
    return "PRESENTATION";
  }
  if (DOCUMENTS.has(type) || type.includes("wordprocessingml")) {
    return "DOCUMENT";
  }
  if (ARCHIVES.has(type)) return "ARCHIVE";
  if (CODE.has(type) || type.startsWith("text/")) return "CODE";
  return "OTHER";
}
