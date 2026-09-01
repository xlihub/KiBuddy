const fs = require('node:fs');
const path = require('node:path');

function listFilesRecursively(rootPath) {
  if (!fs.statSync(rootPath, { throwIfNoEntry: false })?.isDirectory()) return [];
  return fs.readdirSync(rootPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(rootPath, entry.name);
    return entry.isDirectory() ? listFilesRecursively(entryPath) : [entryPath];
  });
}

function requireSinglePath(paths, label) {
  if (paths.length !== 1) throw new Error(`${label} must resolve to exactly one path`);
  return paths[0];
}

module.exports = { listFilesRecursively, requireSinglePath };
