const http = require('http');
const { startApp } = require('./app');
const { initBot, stopBot } = require('./telegram/bot');
const { sequelize } = require('./models');

const SHUTDOWN_TIMEOUT_MS = 10 * 1000;

async function main() {
  const app = await startApp();
  const port = process.env.PORT || 3000;
  const server = http.createServer(app);

  server.listen(port, () => {
    console.log(`PhotoPrint service running on http://localhost:${port}`);
  });

  initBot();

  let shuttingDown = false;

  // Досрочное завершение по SIGTERM/SIGINT: сначала перестаём принимать соединения,
  // затем останавливаем бота и закрываем SQLite, чтобы не терять записи и не рвать запросы.
  async function shutdown(signal) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`[server] ${signal} received, shutting down`);

    const forceExit = setTimeout(() => {
      console.error('[server] shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      await stopBot();
      await new Promise((resolve) => server.close(resolve));
      await sequelize.close();
      clearTimeout(forceExit);
      console.log('[server] shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('[server] shutdown failed:', error.message);
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
