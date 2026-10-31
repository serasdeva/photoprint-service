const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const scriptPath = path.join(__dirname, '..', 'deploy', 'healthcheck.sh');

function hasCommand(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return result.status === 0;
}

const canRun = hasCommand('bash') && hasCommand('curl');

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

test(
  'healthcheck alerts once per outage, reports recovery and supports OnFailure',
  { skip: canRun ? false : 'bash and curl are required' },
  async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photoprint-healthcheck-'));
    const stateFile = path.join(tmpDir, 'state');
    const envFile = path.join(tmpDir, '.env');
    const messages = [];
    let healthy = false;

    const server = http.createServer((req, res) => {
      if (req.url === '/healthz') {
        res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: healthy ? 'ok' : 'error' }));
        return;
      }

      if (req.url === '/botTESTTOKEN/sendMessage') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          messages.push(new URLSearchParams(body).get('text'));
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{"ok":true}');
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    try {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address();

      fs.writeFileSync(
        envFile,
        [
          'BOT_TOKEN=TESTTOKEN',
          'ALERT_CHAT_ID=123',
          `HEALTHCHECK_URL=http://127.0.0.1:${port}/healthz`,
          `TELEGRAM_API_BASE=http://127.0.0.1:${port}`,
          `STATE_FILE=${toPosix(stateFile)}`,
          '',
        ].join('\n')
      );

      // spawn, а не spawnSync: локальный HTTP-сервер должен отвечать, пока скрипт работает.
      const run = (...args) =>
        new Promise((resolve) => {
          const child = spawn('bash', [toPosix(scriptPath), ...args], {
            env: { ...process.env, ENV_FILE: toPosix(envFile), APP_DIR: toPosix(tmpDir) },
          });
          let stdout = '';
          let stderr = '';
          child.stdout.on('data', (chunk) => {
            stdout += chunk;
          });
          child.stderr.on('data', (chunk) => {
            stderr += chunk;
          });
          child.on('close', (status) => resolve({ status, stdout, stderr }));
        });

      // Кириллицу не сверяем: Cygwin-curl на Windows перекодирует argv в системную кодировку.
      let result = await run();
      assert.equal(result.status, 1, result.stderr);
      assert.equal(messages.length, 1);
      assert.match(messages[0], /healthz/);
      assert.match(messages[0], /curl: \(22\)/);

      result = await run();
      assert.equal(result.status, 1);
      assert.equal(messages.length, 1, 'repeated failure must not spam Telegram');

      healthy = true;
      result = await run();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(messages.length, 2);
      assert.match(messages[1], /healthz/);
      assert.doesNotMatch(messages[1], /curl: \(22\)/);

      result = await run();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(messages.length, 2, 'healthy checks stay silent');

      result = await run('--test');
      assert.equal(result.status, 0, result.stderr);
      assert.equal(messages.length, 3);
      assert.match(messages[2], /PhotoPrint/);

      result = await run('--service-failed', 'photoprint.service');
      assert.equal(result.status, 0, result.stderr);
      assert.equal(messages.length, 4);
      assert.match(messages[3], /photoprint\.service/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
);
