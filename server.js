const { startApp } = require('./app');
const { initBot } = require('./telegram/bot');

async function main() {
  const app = await startApp();
  const port = process.env.PORT || 3000;

  app.listen(port, () => {
    console.log(`PhotoPrint service running on http://localhost:${port}`);
  });

  initBot();
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
