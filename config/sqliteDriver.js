const sqlite3 = require('sqlite3');

const BUSY_TIMEOUT_MS = 5000;

/**
 * Sequelize открывает SQLite-соединения напрямую (включая отдельное соединение на каждую
 * транзакцию) и не вызывает afterConnect. Поэтому настройки соединения выставляем здесь:
 * busy_timeout снимает мгновенные SQLITE_BUSY при параллельной записи сайта и бота,
 * synchronous = NORMAL уменьшает число fsync и остаётся безопасным в режиме WAL.
 */
class Database extends sqlite3.Database {
  constructor(...args) {
    super(...args);
    this.configure('busyTimeout', BUSY_TIMEOUT_MS);
    this.run('PRAGMA synchronous = NORMAL;');
  }
}

module.exports = { ...sqlite3, Database };
