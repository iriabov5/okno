import 'reflect-metadata';
import { createAccount } from '../auth/accounts.js';
import { DataSource } from 'typeorm';
import { databaseOptions } from './database.js';
import { addDemoConflict, seedDemo } from './demo.js';

async function main() {
  const operation = process.argv[2];
  if (operation !== 'migrate' && operation !== 'admin' && process.env.DEMO_MODE !== 'true') {
    throw new Error('Для демонстрационных команд задайте DEMO_MODE=true.');
  }
  const source = await new DataSource(databaseOptions()).initialize();
  try {
    if (operation === 'migrate') await source.runMigrations();
    else if (operation === 'admin') {
      await createAccount(
        source.manager,
        {
          login: process.env.ADMIN_LOGIN ?? '',
          password: process.env.ADMIN_PASSWORD ?? '',
          displayName: process.env.ADMIN_DISPLAY_NAME ?? '',
        },
        'ADMIN',
      );
    } else if (operation === 'seed') await seedDemo(source);
    else if (operation === 'conflict') await addDemoConflict(source);
    else throw new Error('Допустимые команды: migrate, admin, seed, conflict.');
    console.info('Команда выполнена.');
  } finally {
    await source.destroy();
  }
}
try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
