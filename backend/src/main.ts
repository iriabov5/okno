import { Logger } from '@nestjs/common';
import { createApp } from './app.js';

async function main() {
  const { app, db } = await createApp();
  process.once('beforeExit', () => {
    if (db.isInitialized) void db.destroy();
  });
  await app.listen(Number(process.env.PORT ?? 3100), process.env.HOST ?? '127.0.0.1');
}

try {
  await main();
} catch (error) {
  new Logger('Startup').error({
    action: 'STARTUP_FAILED',
    errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
  });
  process.exitCode = 1;
}
