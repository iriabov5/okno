import type {
  Role,
  Stage,
  WorkStatus,
  ReleaseStatus,
  WorkType,
  Priority,
  SprintRef,
} from './types';

export const workLabels: Record<WorkStatus, string> = {
  TO_DO: 'К работе',
  IN_PROGRESS: 'В работе',
  IN_TEST: 'На проверке',
  READY: 'Готова к релизу',
};
export const roleLabels: Record<Role, string> = {
  ENGINEER: 'Инженер',
  OWNER: 'Владелец системы',
  OPERATIONS: 'Эксплуатация',
  DUTY: 'Дежурный',
  QA: 'Тестировщик',
  ADMIN: 'Администратор',
};
export const stageLabels: Record<Stage, string> = {
  OWNER: 'Владелец системы',
  OPERATIONS: 'Эксплуатация',
  DUTY: 'Дежурный',
};
export const releaseLabels: Record<ReleaseStatus, string> = {
  DRAFT: 'Черновик',
  IN_REVIEW: 'На согласовании',
  CHANGES_REQUESTED: 'На доработке',
  APPROVED: 'Согласовано',
  DEPLOYED: 'Внедрено',
};

const dateTime = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Moscow',
});
const shortTime = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Moscow',
});
export function dateLabel(value?: string | null) {
  return value ? dateTime.format(new Date(value)) : '—';
}
export function windowLabel(startsAt?: string | null, endsAt?: string | null) {
  if (!startsAt || !endsAt) return 'Окно не указано';
  const sameDay = moscowInput(startsAt).slice(0, 10) === moscowInput(endsAt).slice(0, 10);
  return (
    dateLabel(startsAt) + ' – ' + (sameDay ? shortTime.format(new Date(endsAt)) : dateLabel(endsAt))
  );
}
export function moscowInput(value?: string | null) {
  if (!value) return '';
  const time = new Date(value).getTime();
  return new Date(time + 3 * 3_600_000).toISOString().slice(0, 16);
}
export function moscowValue(input: string): string | null {
  return input ? input + ':00+03:00' : null;
}

export const typeLabels: Record<WorkType, string> = {
  TASK: 'Задача',
  STORY: 'История',
  BUG: 'Баг',
};
export const priorityLabels: Record<Priority, string> = {
  HIGH: 'Высокий',
  NORMAL: 'Обычный',
  LOW: 'Низкий',
};
export const sprintLabels: Record<SprintRef['state'], string> = {
  ACTIVE: 'Активен',
  PLANNED: 'Запланирован',
  CLOSED: 'Завершён',
};
export function sprintPeriod(startsOn: string, endsOn: string) {
  const format = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeZone: 'UTC' });
  return format.formatRange(new Date(startsOn), new Date(endsOn));
}
