import { Global, Module } from '@nestjs/common';
import { DataSource, DataSourceOptions, EntityManager } from 'typeorm';
import { InitialSchema1760000000000 } from './migrations/1760000000000-initial-schema.js';
import { AddAdminRole1794511800000 } from './migrations/1794511800000-add-admin-role.js';
import { AddTaskReviewer1794539200000 } from './migrations/1794539200000-add-task-reviewer.js';
import { TaskActivity1794540200000 } from './migrations/1794540200000-task-activity.js';

import { SprintPlanning1794541200000 } from './migrations/1794541200000-sprint-planning.js';

export function databaseOptions(): DataSourceOptions {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Укажите DATABASE_URL в окружении или .env.');
  return {
    type: 'postgres',
    url,
    migrations: [
      InitialSchema1760000000000,
      AddAdminRole1794511800000,
      AddTaskReviewer1794539200000,
      TaskActivity1794540200000,
      SprintPlanning1794541200000,
    ],
    synchronize: false,
  };
}

export function rows<T>(db: EntityManager, sql: string, parameters: unknown[] = []): Promise<T[]> {
  return db.query<T[]>(sql, parameters);
}

export async function first<T>(db: EntityManager, sql: string, parameters: unknown[] = []) {
  return (await rows<T>(db, sql, parameters))[0];
}

@Global()
@Module({
  providers: [
    {
      provide: DataSource,
      useFactory: () => new DataSource(databaseOptions()).initialize(),
    },
  ],
  exports: [DataSource],
})
export class DatabaseModule {}
