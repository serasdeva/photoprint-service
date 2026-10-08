const fs = require('fs');
const path = require('path');
const session = require('express-session');

/**
 * Синхронное файловое хранилище сессий.
 * Запись выполняется синхронно в момент сохранения, поэтому следующий запрос
 * клиента гарантированно увидит обновлённую сессию (в отличие от temp+rename).
 */
class FileSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.dir = options.path;
    this.ttlMs = (options.ttl || 7 * 24 * 60 * 60) * 1000;
    this.logFn = options.logFn || (() => {});
    fs.mkdirSync(this.dir, { recursive: true });
  }

  _file(sid) {
    const safe = String(sid).replace(/[^a-zA-Z0-9_-]/g, (ch) => `_${ch.charCodeAt(0).toString(16)}`);
    return path.join(this.dir, `${safe}.json`);
  }

  get(sid, cb) {
    try {
      const raw = fs.readFileSync(this._file(sid), 'utf8');
      const sess = JSON.parse(raw);

      const expires = sess && sess.cookie && sess.cookie.expires;
      if (expires && new Date(expires) < new Date()) {
        this.destroy(sid, () => cb(null, null));
        return;
      }

      cb(null, sess);
    } catch (error) {
      if (error.code === 'ENOENT') {
        cb(null, null);
        return;
      }
      this.logFn(error);
      cb(error);
    }
  }

  set(sid, sess, cb) {
    try {
      fs.writeFileSync(this._file(sid), JSON.stringify(sess), 'utf8');
      cb(null);
    } catch (error) {
      this.logFn(error);
      cb(error);
    }
  }

  destroy(sid, cb) {
    try {
      fs.unlinkSync(this._file(sid));
    } catch (error) {
      if (error.code !== 'ENOENT') this.logFn(error);
    }
    cb(null);
  }

  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }
}

module.exports = FileSessionStore;
