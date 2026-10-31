// Excel открывает CSV как текст и сам угадывает кодировку: без BOM кириллица превращается в кракозябры.
const UTF8_BOM = '﻿';
// Значение, начинающееся с этих символов, Excel воспринимает как формулу. Ячейки приходят
// из заявок клиентов, поэтому такие значения обезвреживаются апострофом.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function escapeCell(value) {
  if (value === null || value === undefined) {
    return '';
  }

  let text = String(value);
  if (FORMULA_PREFIX.test(text)) {
    text = `'${text}`;
  }

  // RFC 4180: кавычки удваиваем, поле берём в кавычки, если внутри есть разделитель или перенос
  // строки. Точка с запятой — разделитель в русской локали Excel, поэтому тоже экранируется.
  if (/[";,\n\r]/.test(text) || text !== text.trim()) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function toCsv(header, rows) {
  const lines = [header, ...rows].map((cells) => cells.map(escapeCell).join(','));
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}

// 2026-10-31 14:05 — одинаково читается в любой локали и сортируется как строка.
function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const pad = (part) => String(part).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function formatFileDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

module.exports = { UTF8_BOM, toCsv, escapeCell, formatDateTime, formatFileDate };
