import { expect, test } from './fixtures';

test('Регистрация, администрирование и повторный вход с новой ролью', async ({
  page,
  openPage,
}) => {
  const login = 'team-' + Date.now();
  const name = 'Участник команды';
  const password = 'browser-password-42';
  await page.goto('/');
  await page.getByRole('button', { name: 'Создать учётную запись' }).click();
  await page.getByLabel('Имя').fill(name);
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page.getByRole('heading', { name: 'Доска задач' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Пользователи' })).toHaveCount(0);
  const admin = await openPage();
  await admin.goto('/');
  await admin.getByLabel('Логин').fill('admin');
  await admin.getByLabel('Пароль').fill('okno-demo');
  await admin.getByRole('button', { name: 'Войти' }).click();
  await admin.getByRole('link', { name: 'Пользователи' }).click();
  await expect(admin.getByRole('heading', { name: 'Пользователи' })).toBeVisible();
  await admin.getByRole('button', { name: 'Новый пользователь' }).click();
  const dialog = admin.getByRole('dialog', { name: 'Новый пользователь' });
  const createdLogin = login + '-ops';
  await dialog.getByLabel('Имя').fill('Дежурный команды');
  await dialog.getByLabel('Логин').fill(createdLogin);
  await dialog.getByLabel('Пароль').fill(password);
  await dialog.getByRole('combobox', { name: 'Роль', exact: true }).selectOption('DUTY');
  await dialog.getByRole('button', { name: 'Создать пользователя' }).click();
  await expect(
    admin.getByRole('combobox', { name: 'Роль ' + createdLogin, exact: true }),
  ).toHaveValue('DUTY');
  const role = admin.getByRole('combobox', { name: 'Роль ' + login, exact: true });
  await role.selectOption('QA');
  await expect(role).toHaveValue('QA');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Войти в «Окно»' })).toBeVisible();
  await page.getByLabel('Логин').fill(login);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByText('Тестировщик', { exact: true })).toBeVisible();
});
