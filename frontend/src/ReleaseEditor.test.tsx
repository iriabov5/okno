import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ReleaseEditor } from './ReleaseEditor';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: vi.fn(async (path: string) =>
    path.includes('release-items')
      ? {
          items: [
            {
              id: 'task',
              key: 'OKNO-152',
              title: 'Проверить повторную отправку писем',
              status: 'IN_TEST',
              assignee: { displayName: 'Илья' },
            },
          ],
        }
      : { blockers: [], dependencies: [] },
  ),
}));

afterEach(() => vi.clearAllMocks());

test('Неготовая задача добавляется в черновик после предупреждения', async () => {
  const user = userEvent.setup();
  render(
    <ReleaseEditor
      mode="draft"
      systems={[{ id: 'system', name: 'Уведомления', code: 'NOTIFY' }]}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Подобрать задачи' }));
  await user.click(await screen.findByRole('button', { name: 'Добавить OKNO-152' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Задача ещё не прошла проверку');
  expect(screen.queryByRole('button', { name: 'Удалить OKNO-152' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Добавить в план' }));
  expect(screen.getByRole('button', { name: 'Удалить OKNO-152' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Сохранить черновик' })).toBeEnabled();
});
