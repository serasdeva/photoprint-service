const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.join(__dirname, '..', 'public', 'vendor', 'fontawesome', 'icons.json');

let cache = null;

// Иконки услуги рендерятся как class="fa fa-x", а .fa — это solid-семейство.
function getSolidIcons() {
  if (!cache) {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    cache = Array.isArray(manifest.solid) ? [...manifest.solid].sort() : [];
  }

  return cache;
}

module.exports = { getSolidIcons };
