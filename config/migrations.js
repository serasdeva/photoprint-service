const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const META_TABLE = '_schema_migrations';

async function ensureMetaTable(sequelize) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS ${META_TABLE} (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`
  );
}

async function getAppliedMigrations(sequelize) {
  const [rows] = await sequelize.query(`SELECT name FROM ${META_TABLE}`);
  return new Set(rows.map((row) => row.name));
}

/**
 * Минимальный раннер миграций: sequelize.sync() создаёт недостающие таблицы, а всё, что
 * меняет схему существующей базы (индексы, новые колонки), описывается в migrations/*.js.
 * Каждая миграция применяется в транзакции вместе с записью в реестр, поэтому повторный
 * запуск ничего не делает. Для SQLite DDL транзакционен.
 */
async function runMigrations({ sequelize, queryInterface, logger = console }) {
  if (!sequelize || !queryInterface) {
    throw new Error('runMigrations requires sequelize and queryInterface');
  }
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }

  await ensureMetaTable(sequelize);
  const applied = await getAppliedMigrations(sequelize);
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.js'))
    .sort();
  const executed = [];

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const migration = require(path.join(MIGRATIONS_DIR, file));
    if (!migration || typeof migration.up !== 'function') {
      throw new Error(`Migration ${file} must export an up() function`);
    }

    await sequelize.transaction(async (transaction) => {
      await migration.up({ queryInterface, sequelize, transaction });
      await sequelize.query(`INSERT INTO ${META_TABLE} (name, applied_at) VALUES (?, ?)`, {
        replacements: [file, new Date().toISOString()],
        transaction,
      });
    });

    logger.log(`[migrations] applied ${file}`);
    executed.push(file);
  }

  return executed;
}

module.exports = { runMigrations, META_TABLE, MIGRATIONS_DIR };
