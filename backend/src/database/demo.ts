import { DataSource } from 'typeorm';
import { hashPassword } from '../auth/password.js';
import type { Person, Role, SystemRow } from '../common/types.js';
import { ReleaseCalendar } from '../releases/calendar.js';
import { ReleaseService } from '../releases/release.js';
import { ReleaseScope } from '../releases/scope.js';
import { first, rows } from './database.js';

const users: [string, string, Role][] = [
  ['admin', 'Администратор', 'ADMIN'],
  ['engineer', 'Анна Волкова', 'ENGINEER'],
  ['developer', 'Илья Соколов', 'ENGINEER'],
  ['owner', 'Мария Орлова', 'OWNER'],
  ['operations', 'Денис Лебедев', 'OPERATIONS'],
  ['duty', 'Олег Миронов', 'DUTY'],
  ['qa', 'Елена Смирнова', 'QA'],
];

function moscowWindow(dayOffset: number, start: string, end: string) {
  const date = new Date(Date.now() + 3_600_000 * (3 + 24 * dayOffset)).toISOString().slice(0, 10);
  return { startsAt: date + 'T' + start + ':00+03:00', endsAt: date + 'T' + end + ':00+03:00' };
}

export async function seedDemo(source: DataSource, { fixtures = true } = {}) {
  const data = await source.transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(4080142)');
    for (const [login, name, role] of users) {
      if (await first(db, 'SELECT id FROM users WHERE login=$1', [login])) continue;
      await db.query(
        'INSERT INTO users(login,password_hash,display_name,role) VALUES ($1,$2,$3,$4)',
        [login, hashPassword(process.env.DEMO_PASSWORD ?? 'okno-demo'), name, role],
      );
    }
    const people = new Map(
      (
        await rows<Person & { login: string }>(
          db,
          'SELECT id,login,display_name AS "displayName",role FROM users',
        )
      ).map((person) => [person.login, person]),
    );
    const user = (login: string) => {
      const person = people.get(login);
      if (!person) throw new Error('Missing demo account ' + login);
      return person;
    };
    for (const [code, name] of [
      ['NOTIFY', 'Сервис уведомлений'],
      ['REPORT', 'Сервис отчётности'],
    ]) {
      await db.query(
        `
        INSERT INTO systems(code,name,owner_id,operations_id,duty_id) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (code) DO NOTHING
      `,
        [code, name, user('owner').id, user('operations').id, user('duty').id],
      );
    }
    const systems = await rows<SystemRow>(
      db,
      "SELECT * FROM systems WHERE code IN ('NOTIFY','REPORT')",
    );
    const notification = systems.find((system) => system.code === 'NOTIFY');
    const report = systems.find((system) => system.code === 'REPORT');
    if (!notification || !report) throw new Error('Missing demo systems');
    await db.query(
      "INSERT INTO resources(name) VALUES ('Общая база данных') ON CONFLICT (name) DO NOTHING",
    );
    await db.query(`
      INSERT INTO system_resources(system_id,resource_id)
      SELECT s.id,r.id FROM systems s CROSS JOIN resources r
      WHERE s.code IN ('NOTIFY','REPORT') AND r.name='Общая база данных' ON CONFLICT DO NOTHING
    `);
    const records = [
      ['OKNO-142', 'Ускорить отправку уведомлений', 'READY', 'developer', notification.id],
      ['OKNO-151', 'Добавить журнал доставки уведомлений', 'READY', 'engineer', notification.id],
      ['OKNO-152', 'Проверить повторную отправку писем', 'IN_TEST', 'developer', notification.id],
      ['OKNO-153', 'Улучшить шаблон SMS', 'IN_PROGRESS', 'engineer', notification.id],
      ['OKNO-154', 'Описать настройки уведомлений', 'TO_DO', 'engineer', notification.id],
      ['OKNO-155', 'Сократить время выгрузки отчётов', 'READY', 'developer', report.id],
      ['OKNO-156', 'Добавить фильтр по подразделению', 'IN_PROGRESS', 'developer', report.id],
      ['OKNO-157', 'Обновить справочник типов отчётов', 'TO_DO', null, report.id],
    ] as const;
    for (const [key, title, status, assignee, system] of records) {
      await db.query(
        `
        WITH added AS (
          INSERT INTO work_items(key,title,status,assignee_id,system_id) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (key) DO NOTHING RETURNING id, status, created_at
        )
        INSERT INTO work_item_events(item_id, kind, from_status, to_status, occurred_at)
          SELECT id, 'CREATED', status, status, created_at FROM added
      `,
        [key, title, status, assignee ? user(assignee).id : null, system],
      );
    }
    await db.query(`
      UPDATE work_items SET required_item_id=(SELECT id FROM work_items WHERE key='OKNO-142')
      WHERE key='OKNO-151' AND revision=1 AND required_item_id IS NULL
    `);
    return {
      notification,
      report,
      engineer: user('engineer'),
      owner: user('owner'),
      operations: user('operations'),
    };
  });
  if (!fixtures) return;
  const service = new ReleaseService(source, new ReleaseScope(), new ReleaseCalendar());
  const fixturesToCreate = [
    {
      systemId: data.notification.id,
      title: 'Обновление сервиса уведомлений',
      itemKeys: ['OKNO-142'],
      ...moscowWindow(1, '21:00', '22:00'),
      gitlabTagUrl: 'https://gitlab.example.ru/platform/notifications/-/tags/v1.8.0',
    },
    {
      systemId: data.report.id,
      title: 'Ускорение выгрузки отчётов',
      itemKeys: ['OKNO-155'],
      ...moscowWindow(-1, '10:00', '11:00'),
    },
  ];
  for (const input of fixturesToCreate) {
    if (
      await first(
        source.manager,
        'SELECT id FROM release_requests WHERE author_id=$1 AND title=$2',
        [data.engineer.id, input.title],
      )
    )
      continue;
    let request = await service.create(data.engineer, {
      ...input,
      rollbackPlan: 'Вернуть предыдущую версию и проверить состояние сервиса.',
    });
    request = await service.submit(data.engineer, request.id, request.revision);
    for (const approver of [data.owner, data.operations]) {
      const card = await service.card(approver, request.id);
      if (!card.currentTaskId) throw new Error('Missing demo approval task');
      request = await service.decide(approver, card.currentTaskId, {
        decision: 'APPROVE',
        expectedRevision: card.revision,
      });
    }
  }
}

export async function addDemoConflict(source: DataSource) {
  await source.transaction(async (db) => {
    const resource = await first<{ id: string }>(
      db,
      "SELECT id FROM resources WHERE name='Общая база данных' FOR UPDATE",
    );
    const release = await first<{ starts_at: Date }>(
      db,
      "SELECT starts_at FROM release_requests WHERE title='Обновление сервиса уведомлений' ORDER BY created_at LIMIT 1",
    );
    if (!resource || !release) throw new Error('Сначала загрузите демонстрационные данные.');
    const day = new Date(release.starts_at.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
    await db.query(
      `
      INSERT INTO calendar_blocks(resource_id,starts_at,ends_at,kind,description)
      VALUES ($1,$2,$3,'MAINTENANCE','Плановые работы на общей базе') ON CONFLICT DO NOTHING
    `,
      [resource.id, day + 'T21:00:00+03:00', day + 'T23:00:00+03:00'],
    );
  });
}
