#!/usr/bin/env node
// Bump the plugin version in .claude-plugin/plugin.json and package.json in sync.
// Usage: node scripts/bump-version.mjs <patch|minor|major>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const FILES = [path.join(ROOT, ".claude-plugin", "plugin.json"), path.join(ROOT, "package.json")];

export function bumpVersion(version, kind) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  if (!match) {
    throw new Error(`Invalid semver "${version}".`);
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  switch (kind) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Unknown bump kind "${kind}". Use patch, minor, or major.`);
  }
}

function main() {
  const kind = process.argv[2];
  const manifests = FILES.map((file) => ({ file, data: JSON.parse(fs.readFileSync(file, "utf8")) }));
  const versions = new Set(manifests.map((manifest) => manifest.data.version));
  if (versions.size !== 1) {
    throw new Error(`Version mismatch across manifests: ${[...versions].join(", ")}`);
  }

  const next = bumpVersion(manifests[0].data.version, kind);
  for (const manifest of manifests) {
    manifest.data.version = next;
    fs.writeFileSync(manifest.file, `${JSON.stringify(manifest.data, null, 2)}\n`, "utf8");
  }
  console.log(next);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
