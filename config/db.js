const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');
const sqliteDriver = require('./sqliteDriver');

const dataDir = path.join(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });

const storage = process.env.DB_STORAGE || path.join(dataDir, 'photoprint.sqlite');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage,
  logging: false,
  // Своя обёртка драйвера: busy_timeout и synchronous выставляются на каждом соединении.
  dialectModule: sqliteDriver,
  ...(storage === ':memory:' ? { pool: { max: 1 } } : {}),
  define: {
    timestamps: true,
  },
});

// WAL — свойство файла базы, поэтому достаточно включить один раз при старте.
async function applyPragmas() {
  if (storage === ':memory:') {
    return;
  }

  await sequelize.query('PRAGMA journal_mode = WAL;');
}

async function syncDatabase() {
  try {
    await sequelize.authenticate();
    await applyPragmas();
    await sequelize.sync({ alter: process.env.NODE_ENV === 'development', force: false });
    return sequelize;
  } catch (error) {
    console.error('Database connection failed:', error.message);
    throw error;
  }
}

module.exports = { sequelize, syncDatabase, applyPragmas };
