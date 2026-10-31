// Собирает копии статики с хешем в имени (public/assets) и манифест «исходный путь → хешированный».
// Имя файла меняется вместе с содержимым, поэтому в nginx такие ответы можно кешировать на год.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OUT_DIR = path.join(PUBLIC_DIR, 'assets');
const SOURCE_DIRS = ['css', 'js', 'vendor'];
const ROOT_FILES = ['favicon.svg'];
const ASSET_EXTENSIONS = /\.(css|js|svg|woff2)$/i;
const HASH_LENGTH = 8;

function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const fullPath = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(fullPath) : [fullPath];
    });
}

function toPublicPath(filePath) {
  return `/${path.relative(PUBLIC_DIR, filePath).split(path.sep).join('/')}`;
}

function hashedPath(publicPath, digest) {
  const extension = path.extname(publicPath);
  return `/assets${publicPath.slice(0, -extension.length)}.${digest}${extension}`;
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, HASH_LENGTH);
}

// url() в CSS указывает на соседние файлы, а их имена тоже хешируются —
// поэтому ссылку нужно заменить на путь из манифеста; внешние и data: URL не трогаем.
function rewriteCssUrls(css, cssPublicPath, manifest) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, _quote, rawUrl) => {
    const url = rawUrl.trim();
    if (!url || /^(?:data:|https?:|\/\/|#)/i.test(url)) {
      return match;
    }

    const cut = url.search(/[?#]/);
    const cleanUrl = cut === -1 ? url : url.slice(0, cut);
    const suffix = cut === -1 ? '' : url.slice(cut);
    const resolved = cleanUrl.startsWith('/')
      ? path.posix.normalize(cleanUrl)
      : path.posix.join(path.posix.dirname(cssPublicPath), cleanUrl);
    const hashedUrl = manifest[resolved];

    return hashedUrl ? `url("${hashedUrl}${suffix}")` : match;
  });
}

function buildAssets() {
  const sources = [];

  for (const dir of SOURCE_DIRS) {
    for (const file of walk(path.join(PUBLIC_DIR, dir))) {
      if (ASSET_EXTENSIONS.test(file)) {
        sources.push(file);
      }
    }
  }

  for (const name of ROOT_FILES) {
    const file = path.join(PUBLIC_DIR, name);
    if (fs.existsSync(file)) {
      sources.push(file);
    }
  }

  const manifest = {};
  const contents = new Map();

  for (const source of sources) {
    const publicPath = toPublicPath(source);
    const content = fs.readFileSync(source);
    contents.set(publicPath, content);
    manifest[publicPath] = hashedPath(publicPath, hashContent(content));
  }

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const [publicPath, content] of contents) {
    let output = content;
    if (publicPath.endsWith('.css')) {
      output = rewriteCssUrls(content.toString('utf8'), publicPath, manifest);
    }
    const target = path.join(PUBLIC_DIR, manifest[publicPath].slice(1));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  return manifest;
}

if (require.main === module) {
  const manifest = buildAssets();
  console.log(`Hashed ${Object.keys(manifest).length} assets into public/assets`);
}

module.exports = { buildAssets };
