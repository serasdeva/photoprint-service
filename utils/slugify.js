const slugifyLib = require('slugify');

function makeSlug(value) {
  return slugifyLib(value || '', {
    lower: true,
    strict: true,
    trim: true,
  });
}

module.exports = { makeSlug };
