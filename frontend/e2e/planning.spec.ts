import { expect, test } from './fixtures';

test('Эпик, активная доска, предупреждение о релизе и итоги переноса', async ({ page }) => {
  const suffix = String(Date.now());
  const sprintName = 'Контроль доставки ' + suffix;
  const nextName = 'Повторная отправка ' + suffix;
  await page.goto('/');
  await page.getByLabel('Логин').fill('engineer');
  await page.getByLabel('Пароль').fill('okno-demo');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.getByRole('link', { name: 'Планирование' }).click();

  await page.getByRole('button', { name: 'Новый эпик' }).click();
  let dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: /^Система/ })
    .selectOption({ label: 'Сервис уведомлений' });
  await dialog.getByLabel('Название').fill('Контроль доставки ' + suffix);
  await dialog.getByLabel('Цель').fill('Оператор видит, доставлено ли уведомление.');
  await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Новая задача' }).click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: /^Система/ })
    .selectOption({ label: 'Сервис уведомлений' });
  await dialog.getByRole('combobox', { name: /^Тип/ }).selectOption('STORY');
  await dialog.getByLabel('Название').fill('Вижу статус доставки ' + suffix);
  await dialog
    .getByRole('combobox', { name: /^Эпик/ })
    .selectOption({ label: 'Контроль доставки ' + suffix });
  await dialog
    .getByLabel('Описание')
    .fill(
      'Как оператор, хочу видеть результат доставки. Критерий приёмки — видны статус и время попытки.',
    );
  await dialog.getByRole('button', { name: 'Создать задачу' }).click();
  await expect(dialog).toHaveCount(0);

  for (const [name, startsOn, endsOn] of [
    [sprintName, '2030-11-11', '2030-11-15'],
    [nextName, '2030-11-18', '2030-11-22'],
  ] as const) {
    await page.getByRole('button', { name: 'Новый спринт' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Название').fill(name);
    await dialog.getByLabel('Цель').fill('Показывать оператору результат доставки.');
    await dialog.getByLabel('Начало').fill(startsOn);
    await dialog.getByLabel('Окончание').fill(endsOn);
    await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }

  const { items } = await (await page.request.get('/api/v1/work-items')).json();
  const story = items.find(
    (item: { title: string }) => item.title === 'Вижу статус доставки ' + suffix,
  );
  const ready = items.find((item: { key: string }) => item.key === 'OKNO-151');
  const draft = await page.request.post('/api/v1/release-requests', {
    data: {
      title: 'Доставка ' + suffix,
      systemId: story.systemId,
      itemKeys: [story.key],
      rollbackPlan: 'Вернуть версию.',
      startsAt: '2030-11-15T10:00:00+03:00',
      endsAt: '2030-11-15T11:00:00+03:00',
    },
  });
  expect(draft.ok()).toBeTruthy();
  const release = await draft.json();

  for (const item of [story, ready]) {
    await page.getByRole('button', { name: 'Перенести ' + item.key, exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Куда перенести').selectOption({ label: sprintName });
    await dialog.getByRole('button', { name: 'Перенести', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  const sprint = page.getByRole('region', { name: sprintName });
  await sprint.getByRole('button', { name: 'Запустить спринт' }).click();
  await sprint.getByRole('link', { name: 'Открыть доску' }).click();
  await expect(page.getByLabel('Спринт на доске')).toBeVisible();
  await expect(page.getByText(story.title, { exact: true })).toBeVisible();
  await expect(page.getByText('OKNO-155', { exact: true })).toHaveCount(0);
  await page.getByLabel('Спринт на доске').selectOption('');
  await expect(page.getByText('OKNO-155', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Планирование' }).click();
  await page
    .getByRole('region', { name: sprintName })
    .getByRole('button', { name: 'Завершить спринт' })
    .click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Куда перенести незавершённые карточки')
    .selectOption({ label: nextName });
  await dialog.getByRole('button', { name: 'Проверить перенос' }).click();
  await expect(dialog.getByText('Готово · 1')).toBeVisible();
  await expect(dialog.getByRole('link', { name: release.key })).toBeVisible();
  await expect(dialog.getByText(/Следующий спринт начинается/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Подтвердить завершение' }).click();
  await expect(page.getByRole('dialog', { name: 'Итоги · ' + sprintName })).toBeVisible();
  await expect(page.getByText('1 готово · 1 перенесено', { exact: true }).last()).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть' }).click();
  const moved = page.getByRole('region', { name: nextName });
  await moved.getByRole('button', { name: story.title }).click();
  await expect(page.getByRole('dialog').getByText(sprintName + ' → ' + nextName)).toBeVisible();
});
