import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function checkAccessibility(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })),
  ).toEqual([]);
}

test('Вход, доска и форма задачи доступны с клавиатуры', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Войти в «Окно»' })).toBeVisible();
  await checkAccessibility(page);
  await page.getByLabel('Логин').fill('engineer');
  await page.getByLabel('Пароль').fill('okno-demo');
  await page.getByLabel('Пароль').press('Enter');
  await expect(page.getByRole('heading', { name: 'Доска задач' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'В работе' }).locator('article').first(),
  ).toBeVisible();
  await checkAccessibility(page);

  const create = page.getByRole('button', { name: 'Новая задача' });
  await create.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Новая задача' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Название' })).toBeVisible();
  await checkAccessibility(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(create).toBeFocused();
});

test('Карточка релиза на телефоне сохраняет доступ к действиям @mobile', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Логин').fill('engineer');
  await page.getByLabel('Пароль').fill('okno-demo');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.getByRole('link', { name: 'Мои заявки' }).click();
  await page.getByRole('link', { name: /Обновление сервиса уведомлений/ }).click();
  await expect(page.getByRole('heading', { name: 'Маршрут согласования' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Проверить другое окно' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
  await checkAccessibility(page);
});
