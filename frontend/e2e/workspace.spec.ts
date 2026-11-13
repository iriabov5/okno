import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';

const password = 'okno-demo';
async function login(page: Page, account: string, hash = 'board') {
  await page.goto('/');
  await page.getByLabel('Логин').fill(account);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
  if (hash !== 'board') {
    await page
      .getByRole('link', { name: hash === 'releases' ? 'Мои заявки' : 'На согласовании' })
      .click();
  }
}

async function seed(request: APIRequestContext, title: string) {
  expect(
    (await request.post('/api/v1/auth/login', { data: { login: 'engineer', password } })).ok(),
  ).toBeTruthy();
  const person = await (await request.get('/api/v1/me')).json();
  const { items } = await (await request.get('/api/v1/systems')).json();
  const system = items.find((entry: { code: string }) => entry.code === 'NOTIFY');
  const created = await request.post('/api/v1/work-items', {
    data: { systemId: system.id, title, assigneeId: person.id },
  });
  expect(created.ok()).toBeTruthy();
  return created.json() as Promise<{ id: string; key: string; revision: number; systemId: string }>;
}

async function prepareApproved(
  request: APIRequestContext,
  title: string,
  startsAt: string,
  endsAt: string,
) {
  async function call(path: string, data?: object) {
    const response =
      data === undefined
        ? await request.get('/api/v1' + path)
        : await request.post('/api/v1' + path, { data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  let item = await seed(request, title);
  for (const targetStatus of ['IN_PROGRESS', 'IN_TEST']) {
    item = await call('/work-items/' + item.id + '/transitions', {
      expectedRevision: item.revision,
      targetStatus,
    });
  }
  await call('/auth/login', { login: 'qa', password });
  item = await call('/work-items/' + item.id + '/review/claim', {
    expectedRevision: item.revision,
  });
  item = await call('/work-items/' + item.id + '/transitions', {
    expectedRevision: item.revision,
    targetStatus: 'READY',
  });
  await call('/auth/login', { login: 'engineer', password });
  const draft = await call('/release-requests', {
    systemId: item.systemId,
    title,
    rollbackPlan: 'Вернуть версию.',
    itemKeys: [item.key],
    startsAt,
    endsAt,
  });
  await call('/release-requests/' + draft.id + '/submit', { expectedRevision: draft.revision });
  for (const approver of ['owner', 'operations']) {
    await call('/auth/login', { login: approver, password });
    const { items } = await call('/approval-tasks');
    const task = items.find((entry: { id: string }) => entry.id === draft.id);
    expect(task).toBeDefined();
    await call('/approval-tasks/' + task.taskId + '/decision', {
      decision: 'APPROVE',
      expectedRevision: task.revision,
    });
  }
  return item;
}

test('Доска сохраняет перенос и предупреждает о непроверенной задаче', async ({
  page,
  request,
  openPage,
}) => {
  const title = 'Сквозная задача ' + Date.now();
  const item = await seed(request, title);
  await login(page, 'engineer');
  const mine = page.getByRole('button', { name: 'Мои задачи' });
  const otherTask = page.locator('article').filter({ hasText: 'OKNO-142' });
  await expect(otherTask).toBeVisible();
  await mine.click();
  await expect(mine).toHaveAttribute('aria-pressed', 'true');
  await expect(otherTask).toHaveCount(0);
  await mine.click();
  await expect(otherTask).toBeVisible();
  await page.getByRole('button', { name: 'Переместить ' + item.key }).click();
  await page.getByRole('button', { name: 'В работе', exact: true }).click();
  const inProgress = page
    .getByRole('region', { name: 'В работе' })
    .locator('article')
    .filter({ hasText: title });
  await expect(inProgress).toBeVisible();
  const inTest = page.getByRole('region', { name: 'На проверке' });
  await inProgress.dragTo(inTest, {
    sourcePosition: { x: 16, y: 12 },
    targetPosition: { x: 28, y: 72 },
  });
  await expect(inTest.getByText(title)).toBeVisible();
  await page.reload();
  await expect(inTest.getByText(title)).toBeVisible();
  await page.getByRole('link', { name: 'Мои заявки' }).click();
  await page.getByRole('link', { name: 'Новая заявка' }).click();
  await page
    .getByRole('combobox', { name: 'Система', exact: true })
    .selectOption({ label: 'Сервис уведомлений' });
  await page.getByRole('button', { name: 'Подобрать задачи' }).click();
  await page.getByRole('textbox', { name: 'Поиск задач' }).fill(item.key);
  await page.getByRole('button', { name: 'Добавить ' + item.key }).click();
  await expect(page.getByRole('alert')).toContainText('ещё не прошла проверку');
  await page.getByRole('button', { name: 'Добавить в план' }).click();
  await page.getByLabel('Название', { exact: true }).fill('Релиз ' + item.key);
  await page.getByLabel('Действия при сбое').fill('Вернуть версию.');
  await page.getByLabel('Начало, МСК').fill('2026-12-01T10:00');
  await page.getByLabel('Окончание, МСК').fill('2026-12-01T11:00');
  await expect(page.getByRole('button', { name: 'Отправить на согласование' })).toBeDisabled();
  const qa = await openPage();
  await login(qa, 'qa');
  const reviewCard = qa.locator('article').filter({ hasText: title });
  await expect(reviewCard).toContainText('Ждёт тестировщика');
  await reviewCard.getByRole('button', { name: 'Взять на проверку' }).click();
  await expect(reviewCard).toContainText('Проверяет · Елена Смирнова');
  await qa.getByRole('button', { name: 'Мои задачи' }).click();
  await expect(reviewCard).toBeVisible();
  await expect(qa.locator('article').filter({ hasText: 'OKNO-142' })).toHaveCount(0);
  await reviewCard.getByRole('button', { name: 'Подтвердить проверку' }).click();
  await expect(qa.getByRole('region', { name: 'Готова к релизу' }).getByText(title)).toBeVisible();
  await reviewCard.getByRole('button', { name: title }).click();
  const timeline = qa.getByRole('region', { name: 'История задачи' });
  const events = timeline.getByRole('listitem');
  await expect(events).toHaveCount(5);
  await expect(events.first()).toContainText('Проверка подтверждена');
  await expect(events.nth(1)).toContainText('Взята на проверку');
  await expect(events.nth(1)).toContainText('Елена Смирнова');
  await expect(events.last()).toContainText('Задача создана');
  await expect(timeline.locator('time').first()).toHaveAttribute('datetime', /T/);
  await page.getByRole('button', { name: 'Сохранить черновик' }).click();
  await page.getByRole('button', { name: 'Редактировать черновик' }).click();
  await page.getByRole('button', { name: 'Отправить на согласование' }).click();
  await expect(page.getByText('Сейчас на согласовании')).toBeVisible();
});

test('Разработчик берёт свободную задачу перетаскиванием', async ({ page, request }) => {
  const title = 'Свободная задача ' + Date.now();
  const item = await seed(request, title);
  const unassigned = await request.patch('/api/v1/work-items/' + item.id, {
    data: { assigneeId: null, expectedRevision: item.revision },
  });
  expect(unassigned.ok()).toBeTruthy();
  await login(page, 'engineer');
  const card = page.locator('article').filter({ hasText: title });
  await expect(card.getByRole('button', { name: 'Взять в работу' })).toBeVisible();
  const inProgress = page.getByRole('region', { name: 'В работе' });
  await card.dragTo(inProgress, {
    sourcePosition: { x: 16, y: 12 },
    targetPosition: { x: 28, y: 72 },
  });
  await expect(inProgress.locator('article').filter({ hasText: title })).toContainText(
    'Разработчик · Анна Волкова',
  );
});

test('Перенос окна сохраняет решение владельца и создаёт задачу эксплуатации', async ({
  page,
  openPage,
  request,
}) => {
  const title = 'Перенос уведомлений ' + Date.now();
  await request.post('/api/v1/auth/login', { data: { login: 'engineer', password } });
  const { items } = await (await request.get('/api/v1/release-requests')).json();
  const fixture = items.find(
    (entry: { title: string }) => entry.title === 'Обновление сервиса уведомлений',
  );
  const day = new Date(Date.parse(fixture.startsAt) + 3 * 3_600_000).toISOString().slice(0, 10);
  await prepareApproved(request, title, day + 'T20:00:00+03:00', day + 'T21:00:00+03:00');
  await login(page, 'engineer', 'releases');
  await page.getByRole('link', { name: new RegExp(title) }).click();
  await page.getByRole('button', { name: 'Проверить другое окно' }).click();
  await page.getByLabel('Начало, МСК').fill(day + 'T21:00');
  await page.getByLabel('Окончание, МСК').fill(day + 'T22:00');
  await page.getByRole('button', { name: 'Проверить окно' }).click();
  await page.getByRole('button', { name: 'Применить предложенное окно' }).click();
  await page.getByRole('button', { name: 'Проверить изменения' }).click();
  const preview = page.getByRole('region', { name: 'Последствия изменений' });
  await expect(preview.getByText('Сохраняется')).toBeVisible();
  await expect(preview.getByText('Повторная проверка')).toBeVisible();
  await expect(preview.getByText('Новый этап')).toBeVisible();
  await page.getByRole('button', { name: 'Подтвердить изменения' }).click();
  await expect(page.getByText('Сейчас на согласовании')).toBeVisible();
  const ops = await openPage();
  await login(ops, 'operations', 'queue');
  await expect(ops.getByRole('link', { name: new RegExp(title) })).toBeVisible();
});

test('Отметка внедрения сохраняет дату и GitLab Release', async ({ page, request }) => {
  const title = 'Запись внедрения ' + Date.now();
  const item = await prepareApproved(
    request,
    title,
    '2025-06-10T10:00:00+03:00',
    '2025-06-10T11:00:00+03:00',
  );
  await login(page, 'engineer', 'releases');
  await page.getByRole('link', { name: new RegExp(title) }).click();
  await page.getByRole('button', { name: 'Отметить внедрение' }).click();
  await page.getByLabel('Фактическое время, МСК').fill('2025-06-10T10:35');
  await page
    .getByLabel('Ссылка на GitLab Release')
    .fill('https://gitlab.example.ru/team/reports/-/releases/v1.2.0');
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('link', { name: 'GitLab Release' })).toBeVisible();
  await page.getByRole('link', { name: 'Доска', exact: true }).click();
  await page.reload();
  await expect(page.locator('article').filter({ hasText: item.key })).toContainText('Внедрена');
});

test('Изменение состава и тега отправляет повторную задачу владельцу', async ({
  page,
  request,
}) => {
  const title = 'Изменение состава ' + Date.now();
  await prepareApproved(request, title, '2025-06-11T10:00:00+03:00', '2025-06-11T11:00:00+03:00');
  await login(page, 'engineer', 'releases');
  await page.getByRole('link', { name: new RegExp(title) }).click();
  await page.getByRole('button', { name: 'Добавить тег' }).click();
  await page
    .getByLabel(/Тег GitLab/)
    .fill('https://gitlab.example.ru/team/notifications/-/tags/v2');
  await page.getByRole('button', { name: 'Подобрать задачи' }).click();
  await page.getByRole('textbox', { name: 'Поиск задач' }).fill('OKNO-142');
  await page.getByRole('button', { name: 'Добавить OKNO-142' }).click();
  await page.getByRole('button', { name: 'Проверить изменения' }).click();
  const preview = page.getByRole('region', { name: 'Последствия изменений' });
  await expect(preview.getByText('Добавлены задачи OKNO-142')).toBeVisible();
  await expect(preview.getByText('Изменён тег GitLab.')).toBeVisible();
  await expect(preview.getByText('Сохраняется')).toBeVisible();
  await expect(preview.getByText('Повторная проверка')).toBeVisible();
  await page.getByRole('button', { name: 'Подтвердить изменения' }).click();
  await expect(page.getByText(/Мария Орлова · Владелец системы/)).toBeVisible();
});

test('Узкий экран: меню перемещения и проверка состава @mobile', async ({ page, request }) => {
  const title = 'Мобильная задача ' + Date.now();
  const item = await seed(request, title);
  await login(page, 'engineer');
  await page.getByRole('button', { name: 'Переместить ' + item.key }).click();
  await page.getByRole('button', { name: 'В работе', exact: true }).click();
  await expect(page.getByRole('region', { name: 'В работе' }).getByText(title)).toBeVisible();
  await page.getByRole('link', { name: 'Мои заявки' }).click();
  await page.getByRole('link', { name: 'Новая заявка' }).click();
  await page
    .getByRole('combobox', { name: 'Система', exact: true })
    .selectOption({ label: 'Сервис уведомлений' });
  await page.getByRole('button', { name: 'Подобрать задачи' }).click();
  await page.getByRole('textbox', { name: 'Поиск задач' }).fill(item.key);
  await page.getByRole('button', { name: 'Добавить ' + item.key }).click();
  await expect(page.getByRole('button', { name: 'Добавить в план' })).toBeVisible();
});
