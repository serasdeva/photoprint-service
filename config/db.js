const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');

const dataDir = path.join(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });

const storage = process.env.DB_STORAGE || path.join(dataDir, 'photoprint.sqlite');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage,
  logging: false,
  ...(storage === ':memory:' ? { pool: { max: 1 } } : {}),
  define: {
    timestamps: true,
  },
});

async function syncDatabase() {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: process.env.NODE_ENV === 'development', force: false });
    return sequelize;
  } catch (error) {
    console.error('Database connection failed:', error.message);
    throw error;
  }
}

module.exports = { sequelize, syncDatabase };
