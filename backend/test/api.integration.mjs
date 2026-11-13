import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import supertest from 'supertest';
import { createApp } from '../dist/app.js';
import { seedDemo } from '../dist/database/demo.js';

test('HTTP и PostgreSQL: от задачи до внедрения с проверкой конкурирующих команд', async (t) => {
  const base = process.env.TEST_DATABASE_URL;
  assert.ok(base, 'Укажите TEST_DATABASE_URL для временной тестовой базы.');
  const name = 'okno_it_' + process.pid + '_' + Date.now();
  const url = new URL(base);
  const databaseAdmin = await new DataSource({ type: 'postgres', url: base }).initialize();
  await databaseAdmin.query('CREATE DATABASE ' + name);
  url.pathname = '/' + name;
  process.env.DATABASE_URL = url.toString();
  process.env.NODE_ENV = 'test';
  const context = { server: null };
  t.after(async () => {
    try {
      await context.server?.app.close();
      if (context.server?.db.isInitialized) await context.server.db.destroy();
    } finally {
      await databaseAdmin.query('DROP DATABASE ' + name + ' WITH (FORCE)');
      await databaseAdmin.destroy();
    }
  });
  const { app, db } = (context.server = await createApp());
  await db.runMigrations();
  await seedDemo(db, { fixtures: false });
  await app.init();
  const server = app.getHttpServer();
  const request = supertest(server);
  async function signIn(login) {
    const result = await request
      .post('/api/v1/auth/login')
      .send({ login, password: 'okno-demo' })
      .expect(200);
    return result.headers['set-cookie'][0].split(';')[0];
  }
  async function call(method, path, cookie, body, status = 200) {
    const action = request[method]('/api/v1' + path);
    if (cookie) action.set('Cookie', cookie);
    if (body) action.send(body);
    return (await action.expect(status)).body;
  }
  process.env.SIGNUP_ENABLED = 'true';
  const admin = await signIn('admin');
  const registered = await request
    .post('/api/v1/auth/register')
    .send({
      login: 'new.engineer',
      displayName: 'Новый участник',
      password: 'test-password-42',
    })
    .expect(201);
  const newCookie = registered.headers['set-cookie'][0].split(';')[0];
  assert.equal(registered.body.role, 'ENGINEER');
  await call('get', '/admin/users', newCookie, null, 403);
  await call(
    'post',
    '/auth/register',
    null,
    {
      login: 'NEW.ENGINEER',
      displayName: 'Повтор',
      password: 'test-password-42',
    },
    409,
  );
  const list = await call('get', '/admin/users', admin);
  assert.ok(list.items.some((entry) => entry.login === 'new.engineer'));
  assert.equal(
    (await call('patch', '/admin/users/' + registered.body.id + '/role', admin, { role: 'QA' }))
      .role,
    'QA',
  );
  await call('get', '/me', newCookie, null, 401);
  const loginAgain = await call('post', '/auth/login', null, {
    login: 'NEW.ENGINEER',
    password: 'test-password-42',
  });
  assert.equal(loginAgain.role, 'QA');
  const account = await call(
    'post',
    '/admin/users',
    admin,
    {
      login: 'new.operations',
      displayName: 'Сотрудник эксплуатации',
      password: 'test-password-42',
      role: 'OPERATIONS',
    },
    201,
  );
  assert.equal(account.role, 'OPERATIONS');
  const ownerAccount = list.items.find((entry) => entry.login === 'owner');
  assert.equal(
    (await call('patch', '/admin/users/' + ownerAccount.id + '/role', admin, { role: 'QA' }, 409))
      .code,
    'USER_ASSIGNED',
  );
  process.env.SIGNUP_ENABLED = 'false';
  await call(
    'post',
    '/auth/register',
    null,
    {
      login: 'closed.signup',
      displayName: 'Закрытая регистрация',
      password: 'test-password-42',
    },
    403,
  );

  const engineer = await signIn('engineer');
  const owner = await signIn('owner');
  const ops = await signIn('operations');
  const duty = await signIn('duty');
  const qa = await signIn('qa');
  await call('get', '/work-items', null, null, 401);
  const systems = await call('get', '/systems', engineer);
  const system = systems.items.find((entry) => entry.code === 'NOTIFY');
  const me = await call('get', '/me', engineer);
  let task = await call(
    'post',
    '/work-items',
    engineer,
    { systemId: system.id, title: 'Подтвердить доставку', assigneeId: me.id },
    201,
  );
  assert.equal(task.history[0].kind, 'CREATED');
  assert.equal(task.history[0].actor, me.displayName);
  assert.equal(task.history[0].nextAssignee, me.displayName);
  const move = (cookie, targetStatus, expectedRevision, status) =>
    call(
      'post',
      '/work-items/' + task.id + '/transitions',
      cookie,
      { targetStatus, expectedRevision },
      status,
    );
  const parallel = await Promise.all(
    [1, 2].map(() =>
      request
        .post('/api/v1/work-items/' + task.id + '/transitions')
        .set('Cookie', engineer)
        .send({ targetStatus: 'IN_PROGRESS', expectedRevision: 1 }),
    ),
  );
  assert.deepEqual(parallel.map((response) => response.status).sort(), [200, 409]);
  task = parallel.find((response) => response.status === 200).body;
  task = await move(engineer, 'IN_TEST', task.revision);
  await move(engineer, 'READY', task.revision, 403);

  const other = await call(
    'post',
    '/work-items',
    engineer,
    {
      systemId: system.id,
      title: 'Предшествующая задача',
      assigneeId: me.id,
    },
    201,
  );
  const reassigned = await call('patch', '/work-items/' + other.id, engineer, {
    expectedRevision: other.revision,
    assigneeId: null,
  });
  assert.deepEqual(
    reassigned.history.map(({ kind, actor, previousAssignee, nextAssignee }) => ({
      kind,
      actor,
      previousAssignee,
      nextAssignee,
    })),
    [
      {
        kind: 'ASSIGNMENT',
        actor: me.displayName,
        previousAssignee: me.displayName,
        nextAssignee: null,
      },
      {
        kind: 'CREATED',
        actor: me.displayName,
        previousAssignee: null,
        nextAssignee: me.displayName,
      },
    ],
  );
  await call(
    'post',
    '/work-items/' + other.id + '/transitions',
    qa,
    { expectedRevision: reassigned.revision, targetStatus: 'IN_PROGRESS' },
    403,
  );
  const claimedWork = await call('post', '/work-items/' + other.id + '/transitions', engineer, {
    expectedRevision: reassigned.revision,
    targetStatus: 'IN_PROGRESS',
  });
  assert.equal(claimedWork.assignee.id, me.id);
  assert.equal(claimedWork.history[0].actor, me.displayName);
  const dependent = await call(
    'post',
    '/work-items',
    engineer,
    {
      systemId: system.id,
      title: 'Зависимая задача',
      assigneeId: me.id,
      requiredItemId: other.id,
    },
    201,
  );
  assert.equal(
    (
      await call(
        'patch',
        '/work-items/' + other.id,
        engineer,
        {
          expectedRevision: claimedWork.revision,
          requiredItemId: dependent.id,
        },
        400,
      )
    ).code,
    'INVALID_DEPENDENCY',
  );

  const tag = 'https://gitlab.example.ru/team/notify/-/tags/v1';
  const link = 'https://gitlab.example.ru/team/notify/-/releases/v1';
  const draft = {
    systemId: system.id,
    title: 'Интеграционный релиз',
    rollbackPlan: 'Вернуть версию',
    startsAt: '2025-06-10T21:00:00+03:00',
    endsAt: '2025-06-10T22:00:00+03:00',
    itemKeys: [task.key],
    gitlabTagUrl: tag,
  };
  let release = await call('post', '/release-requests', engineer, draft, 201);
  const path = '/release-requests/' + release.id;
  await call('get', path, owner, null, 404);
  assert.equal(
    (await call('post', path + '/submit', engineer, { expectedRevision: release.revision }, 409))
      .code,
    'RELEASE_SCOPE_BLOCKED',
  );
  await move(qa, 'READY', task.revision, 403);
  const claimPath = '/work-items/' + task.id + '/review/claim';
  const claimRevision = task.revision;
  await call('post', claimPath, engineer, { expectedRevision: claimRevision }, 403);
  task = await call('post', claimPath, qa, { expectedRevision: claimRevision });
  assert.equal(task.assignee.id, me.id);
  assert.equal(task.reviewer.displayName, 'Елена Смирнова');
  await call('post', claimPath, qa, { expectedRevision: claimRevision }, 409);
  const secondQa = await request
    .post('/api/v1/auth/login')
    .send({ login: 'new.engineer', password: 'test-password-42' })
    .expect(200);
  const secondQaCookie = secondQa.headers['set-cookie'][0].split(';')[0];
  await move(secondQaCookie, 'READY', task.revision, 403);
  await call('post', claimPath, secondQaCookie, { expectedRevision: task.revision }, 409);
  const qaPerson = await call('get', '/me', qa);
  await call('patch', '/admin/users/' + qaPerson.id + '/role', admin, { role: 'ENGINEER' }, 409);
  task = await move(qa, 'READY', task.revision);
  assert.deepEqual(
    task.history.map((entry) => entry.kind),
    ['STATUS', 'REVIEW_CLAIMED', 'STATUS', 'STATUS', 'CREATED'],
  );
  assert.equal(task.history[1].actor, 'Елена Смирнова');
  await db.query(`
    CREATE FUNCTION fail_submission_event() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.type = 'SUBMITTED' THEN RAISE EXCEPTION 'forced test failure'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER fail_submission_event BEFORE INSERT ON release_events
      FOR EACH ROW EXECUTE FUNCTION fail_submission_event();
  `);
  await call('post', path + '/submit', engineer, { expectedRevision: release.revision }, 500);
  assert.equal((await call('get', path, engineer)).revision, release.revision);
  assert.deepEqual((await call('get', '/approval-tasks', owner)).items, []);
  await db.query(
    'DROP TRIGGER fail_submission_event ON release_events; DROP FUNCTION fail_submission_event()',
  );
  release = await call('post', path + '/submit', engineer, { expectedRevision: release.revision });
  await call('get', path, ops, null, 404);
  const submittedWork = await call('get', '/work-items/' + task.id, qa);
  const submitted = submittedWork.history[0];
  assert.equal(submitted.kind, 'RELEASE_SUBMITTED');
  assert.equal(submitted.releaseKey, release.key);
  assert.equal(submitted.actor, me.displayName);
  await db.query(
    "UPDATE release_events SET details=details-'itemKeys' WHERE request_id=$1 AND type='SUBMITTED'",
    [release.id],
  );
  assert.equal(
    (await call('get', '/work-items/' + task.id, qa)).history[0].kind,
    'RELEASE_SUBMITTED',
  );
  assert.equal((await call('get', '/work-items/' + other.id, qa)).history.length, 3);

  async function approve(cookie, releaseId = release.id) {
    const { items } = await call('get', '/approval-tasks', cookie);
    const active = items.find((entry) => entry.id === releaseId);
    assert.ok(active);
    return call('post', '/approval-tasks/' + active.taskId + '/decision', cookie, {
      decision: 'APPROVE',
      expectedRevision: active.revision,
    });
  }
  const ownerTask = (await call('get', '/approval-tasks', owner)).items[0];
  await call(
    'post',
    '/approval-tasks/' + ownerTask.taskId + '/decision',
    engineer,
    {
      decision: 'APPROVE',
      expectedRevision: ownerTask.revision,
    },
    404,
  );
  release = await call('post', '/approval-tasks/' + ownerTask.taskId + '/decision', owner, {
    decision: 'RETURN',
    expectedRevision: ownerTask.revision,
    comment: 'Уточните план отката.',
  });
  assert.equal(release.status, 'CHANGES_REQUESTED');
  release = await call('patch', path, engineer, {
    expectedRevision: release.revision,
    rollbackPlan: 'Вернуть версию и проверить доставку.',
  });
  release = await call('post', path + '/submit', engineer, { expectedRevision: release.revision });
  release = await approve(owner);
  release = await approve(ops);
  const noChange = await call('post', path + '/changes', engineer, {
    expectedRevision: release.revision,
    proposedChanges: { itemKeys: [task.key] },
  });
  assert.equal(noChange.revision, release.revision);
  const revised = {
    expectedRevision: release.revision,
    proposedChanges: {
      startsAt: '2025-06-10T23:00:00+03:00',
      endsAt: '2025-06-11T00:00:00+03:00',
    },
  };
  const preview = await call('post', path + '/changes/preview', engineer, revised);
  assert.deepEqual(
    preview.steps.map((step) => step.effect),
    ['KEEP', 'RECHECK', 'ADD'],
  );
  const [resource] = await db.query('SELECT resource_id FROM system_resources WHERE system_id=$1', [
    system.id,
  ]);
  await db.query(
    'INSERT INTO calendar_blocks(resource_id,starts_at,ends_at,kind,description) VALUES ($1,$2,$3,$4,$5)',
    [
      resource.resource_id,
      revised.proposedChanges.startsAt,
      revised.proposedChanges.endsAt,
      'TEST',
      'Работы',
    ],
  );
  assert.equal(
    (await call('post', path + '/changes', engineer, revised, 409)).code,
    'WINDOW_CONFLICT',
  );
  assert.equal((await call('get', path, engineer)).revision, release.revision);
  await db.query("DELETE FROM calendar_blocks WHERE kind='TEST'");
  release = await call('post', path + '/changes', engineer, revised);
  await call('post', path + '/changes', engineer, revised, 409);
  release = await approve(ops);
  release = await approve(duty);
  const impact = await call('get', '/work-items/' + task.id + '/return-impact', qa);
  assert.equal(impact.releases[0].key, release.key);
  task = await move(qa, 'IN_PROGRESS', task.revision);
  assert.equal(
    (
      await call(
        'post',
        path + '/deploy',
        engineer,
        {
          expectedRevision: release.revision,
          deployedAt: '2025-06-10T23:10:00+03:00',
        },
        409,
      )
    ).code,
    'RELEASE_SCOPE_BLOCKED',
  );
  task = await move(engineer, 'IN_TEST', task.revision);
  assert.equal(task.reviewer, null);
  task = await call('post', claimPath, qa, { expectedRevision: task.revision });
  task = await move(qa, 'READY', task.revision);
  const second = await call(
    'post',
    '/release-requests',
    engineer,
    { ...draft, title: 'Другой релиз' },
    201,
  );
  const secondPath = '/release-requests/' + second.id;
  await call('post', secondPath + '/submit', engineer, { expectedRevision: second.revision });
  await approve(owner, second.id);
  const secondApproved = await approve(ops, second.id);
  const deploy = await Promise.all([
    request
      .post('/api/v1' + path + '/deploy')
      .set('Cookie', engineer)
      .send({
        expectedRevision: release.revision,
        deployedAt: '2025-06-10T23:10:00+03:00',
        gitlabReleaseUrl: link,
      }),
    request
      .post('/api/v1' + secondPath + '/deploy')
      .set('Cookie', engineer)
      .send({
        expectedRevision: secondApproved.revision,
        deployedAt: '2025-06-10T21:10:00+03:00',
        gitlabReleaseUrl: link,
      }),
  ]);
  assert.deepEqual(deploy.map((entry) => entry.status).sort(), [200, 409]);
  const deployed = deploy.find((entry) => entry.status === 200).body;
  assert.equal(deployed.gitlabReleaseUrl, link);
  const deployedPath = '/release-requests/' + deployed.id;
  await call(
    'patch',
    deployedPath + '/gitlab-release',
    engineer,
    {
      expectedRevision: deployed.revision,
      gitlabReleaseUrl: link.replace('/v1', '/wrong'),
    },
    400,
  );
  const attached = await call('patch', deployedPath + '/gitlab-release', engineer, {
    expectedRevision: deployed.revision,
    gitlabReleaseUrl: link + '#notes',
  });
  assert.equal(attached.deployedAt, deployed.deployedAt);
  assert.equal(attached.history[0].type, 'GITLAB_RELEASE_LINKED');
  const onBoard = await call('get', '/work-items/' + task.id, engineer);
  assert.equal(onBoard.deployedRelease.key, deployed.key);
  const deploymentEvents = onBoard.history.filter((event) => event.kind === 'RELEASE_DEPLOYED');
  assert.equal(deploymentEvents.length, 1);
  assert.equal(deploymentEvents[0].releaseKey, deployed.key);
  assert.equal(deploymentEvents[0].occurredAt, deployed.deployedAt);
  assert.equal(deploymentEvents[0].actor, me.displayName);
  const makeSprint = (name) =>
    call(
      'post',
      '/sprints',
      engineer,
      {
        name,
        goal: 'Уточнить статус уведомлений',
        startsOn: '2030-11-11',
        endsOn: '2030-11-15',
      },
      201,
    );
  const [sprint, next] = await Promise.all([makeSprint('Доставка'), makeSprint('Уведомления')]);
  const sprintPath = '/sprints/' + sprint.id;
  const planPath = '/work-items/' + other.id + '/sprint';
  await call('post', sprintPath + '/start', engineer, { expectedRevision: sprint.revision }, 409);
  await call(
    'post',
    planPath,
    qa,
    { expectedRevision: claimedWork.revision, sprintId: sprint.id },
    403,
  );
  const planned = await call('post', planPath, engineer, {
    expectedRevision: claimedWork.revision,
    sprintId: sprint.id,
  });
  const nextItem = await call(
    'post',
    '/work-items',
    engineer,
    {
      systemId: system.id,
      title: 'Уточнить текст уведомления',
    },
    201,
  );
  await call('post', '/work-items/' + nextItem.id + '/sprint', engineer, {
    expectedRevision: nextItem.revision,
    sprintId: next.id,
  });
  const active = await call('post', sprintPath + '/start', engineer, {
    expectedRevision: sprint.revision + 1,
  });
  const secondStart = await call(
    'post',
    '/sprints/' + next.id + '/start',
    engineer,
    {
      expectedRevision: next.revision + 1,
    },
    409,
  );
  assert.equal(secondStart.code, 'ACTIVE_SPRINT_EXISTS');
  const completion = { expectedRevision: active.revision, destinationSprintId: next.id };
  const oldPreview = await call('post', sprintPath + '/completion-preview', engineer, completion);
  const edited = await call('patch', '/work-items/' + other.id, engineer, {
    title: 'Обновлённая предшествующая задача',
    expectedRevision: planned.revision,
  });
  const stale = await call(
    'post',
    sprintPath + '/complete',
    engineer,
    {
      ...completion,
      previewToken: oldPreview.previewToken,
    },
    409,
  );
  assert.equal(stale.code, 'PREVIEW_CHANGED');
  assert.equal((await call('get', '/work-items/' + other.id, engineer)).sprint.id, sprint.id);
  const updatedPreview = await call(
    'post',
    sprintPath + '/completion-preview',
    engineer,
    completion,
  );
  await call('post', sprintPath + '/complete', engineer, {
    ...completion,
    previewToken: updatedPreview.previewToken,
  });
  const transferred = await call('get', '/work-items/' + other.id, engineer);
  assert.equal(transferred.sprint.id, next.id);
  assert.equal(transferred.revision, edited.revision + 1);
  assert.equal(transferred.history[0].fromSprint.id, sprint.id);
  const results = await call('get', sprintPath + '/results', qa);
  assert.equal(results.items[0].statusAtClose, 'IN_PROGRESS');
  assert.equal(results.items[0].destinationSprintId, next.id);

  await request.get('/docs/').expect(200);
  await request.get('/api.yaml').expect(200);
  const swagger = (await request.get('/api.json').expect(200)).body;
  assert.equal(
    swagger.paths['/api/v1/release-requests/{id}/deploy'].post.responses['200'].content[
      'application/json'
    ].schema.$ref,
    '#/components/schemas/ReleaseResponseDto',
  );
});
