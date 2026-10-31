// Соцсети не берут относительные пути и игнорируют SVG, поэтому в og:image попадает только
// растровая картинка из `/uploads` и только абсолютный URL.
const RASTER_OG_IMAGE = /^\/uploads\/[^\s?#]+?\.(jpe?g|png|webp)$/i;

function publicOgImageUrl(origin, image) {
  const candidate = String(image || '');
  // `..` превратил бы og:image в ссылку на другой путь того же origin.
  if (candidate.includes('..') || !RASTER_OG_IMAGE.test(candidate)) {
    return null;
  }
  return `${origin}${candidate}`;
}

module.exports = { publicOgImageUrl };
