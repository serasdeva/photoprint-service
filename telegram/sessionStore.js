const fs = require('fs');
const path = require('path');

/**
 * Простое файловое хранилище сессий диалога для Telegraf.
 * Синхронные операции, чтобы состояние wizard-заказа не терялось при рестарте.
 */
class FileSessionStore {
  constructor(options = {}) {
    this.dir = options.path;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  _file(key) {
    const safe = String(key).replace(
      /[^a-zA-Z0-9_-]/g,
      (ch) => `_${ch.charCodeAt(0).toString(16)}`
    );
    return path.join(this.dir, `${safe}.json`);
  }

  get(key) {
    try {
      return JSON.parse(fs.readFileSync(this._file(key), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Telegram session read failed:', error.message);
      }
      return undefined;
    }
  }

  set(key, value) {
    try {
      fs.writeFileSync(this._file(key), JSON.stringify(value), 'utf8');
    } catch (error) {
      console.error('Telegram session write failed:', error.message);
    }
  }

  delete(key) {
    try {
      fs.unlinkSync(this._file(key));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Telegram session delete failed:', error.message);
      }
    }
  }

  /** Удаляет брошенные диалоги: состояние заказа не должно жить в файлах месяцами. */
  prune(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    let entries;
    try {
      entries = fs.readdirSync(this.dir);
    } catch (error) {
      console.error('Telegram session prune failed:', error.message);
      return 0;
    }

    let removed = 0;
    for (const entry of entries) {
      if (!entry.endsWith('.json')) {
        continue;
      }

      const file = path.join(this.dir, entry);
      try {
        if (Date.now() - fs.statSync(file).mtimeMs > maxAgeMs) {
          fs.unlinkSync(file);
          removed += 1;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error('Telegram session prune failed:', error.message);
        }
      }
    }

    return removed;
  }
}

module.exports = FileSessionStore;
