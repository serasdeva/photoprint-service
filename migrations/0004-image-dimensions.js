// После обработки sharp картинки ужимаются, и шаблоны могут ставить реальные width/height:
// браузер резервирует место до загрузки файла, layout не прыгает. Для старых записей и видео
// значения остаются NULL — шаблон просто не выводит атрибуты.
//
// Колонки добавляются только если их ещё нет: в development `sync({ alter: true })` успевает
// создать их раньше миграции, и повторный ALTER TABLE упал бы с «duplicate column name».
async function addMissingColumns(sequelize, transaction, table, columns) {
  const [rows] = await sequelize.query(`PRAGMA table_info("${table}")`, { transaction });
  const existing = new Set(rows.map((row) => row.name));

  for (const column of columns) {
    if (existing.has(column)) {
      continue;
    }
    await sequelize.query(`ALTER TABLE "${table}" ADD COLUMN "${column}" INTEGER`, { transaction });
  }
}

module.exports = {
  async up({ sequelize, transaction }) {
    await addMissingColumns(sequelize, transaction, 'Services', ['width', 'height']);
    await addMissingColumns(sequelize, transaction, 'GalleryItems', ['width', 'height']);
  },
};
