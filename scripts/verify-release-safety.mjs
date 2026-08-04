import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const outputDirectory = new URL("../dist/", import.meta.url);
const textExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".txt"]);
const decoded = (value) => Buffer.from(value, "base64").toString("utf8");

const forbiddenText = [
  decoded("Y2lzY28="),
  decoded("dGhvdXNhbmRleWVz"),
  decoded("dGUtbGFicw=="),
  decoded("MWtleWVz"),
  decoded("dHNvcHJlaw=="),
];

const secretPatterns = [
  /AKIA[0-9A-Z]{16}/,
  /ASIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z_-]{35}/,
  /gh[pousr]_[A-Za-z0-9_]{30,}/,
  /github_pat_[A-Za-z0-9_]{30,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
];

async function textFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory.pathname, entry.name);
    if (entry.isDirectory()) return textFiles(new URL(`${entry.name}/`, directory));
    return textExtensions.has(extname(entry.name).toLowerCase()) ? [path] : [];
  }));
  return nested.flat();
}

const violations = [];
for (const path of await textFiles(outputDirectory)) {
  const content = await readFile(path, "utf8");
  const lower = content.toLowerCase();
  for (const value of forbiddenText) {
    if (lower.includes(value)) violations.push(`${relative(outputDirectory.pathname, path)}: forbidden text`);
  }
  for (const pattern of secretPatterns) {
    if (pattern.test(content)) violations.push(`${relative(outputDirectory.pathname, path)}: credential pattern`);
  }
}

if (violations.length > 0) {
  throw new Error(`Release safety check failed:\n${[...new Set(violations)].join("\n")}`);
}

console.log("Verified release bundle contains no forbidden branding or credential patterns");
