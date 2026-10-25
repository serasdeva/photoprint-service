// SQLite's LIKE is case-insensitive only for ASCII: 'Тестовая' LIKE '%тест%' returns 0.
// Public pages already filter in JS for that reason; admin lists use the same helper so
// Cyrillic search behaves identically in the panel and on the site.
function normalize(value) {
  return String(value || '').toLocaleLowerCase('ru-RU');
}

function filterByTerm(rows, term, fields) {
  const needle = normalize(term).trim();
  if (!needle) {
    return rows;
  }

  return rows.filter((row) => fields.some((field) => normalize(row[field]).includes(needle)));
}

function paginate(rows, requestedPage, limit) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(Math.max(1, Number.parseInt(requestedPage, 10) || 1), totalPages);

  return {
    items: rows.slice((page - 1) * limit, page * limit),
    pagination: { page, totalPages, total },
  };
}

module.exports = { normalize, filterByTerm, paginate };
