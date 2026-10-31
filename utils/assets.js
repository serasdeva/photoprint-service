// Отдаёт хешированный URL из манифеста, собранного `npm run build:assets`.
// Без манифеста (например, `node --test` без сборки) шаблоны работают по исходным путям.
const fs = require('fs');
const path = require('path');

const MANIFEST_FILE = path.join(__dirname, '..', 'public', 'assets', 'manifest.json');

let manifest = {};
let manifestMtime = -1;

function loadManifest() {
  try {
    const stats = fs.statSync(MANIFEST_FILE);
    if (stats.mtimeMs !== manifestMtime) {
      manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
      manifestMtime = stats.mtimeMs;
    }
  } catch {
    manifest = {};
  }
  return manifest;
}

function asset(publicPath) {
  if (typeof publicPath !== 'string' || !publicPath.startsWith('/')) {
    return publicPath;
  }
  return loadManifest()[publicPath] || publicPath;
}

module.exports = { asset };
