import type { Person } from '../common/types.js';

export const statuses = ['TO_DO', 'IN_PROGRESS', 'IN_TEST', 'READY'] as const;
export type WorkStatus = (typeof statuses)[number];

/** Проверку завершает тестировщик, который взял задачу на себя. */
export function allowedTransitions(
  status: WorkStatus,
  assignee: string | null,
  person: Person,
  reviewer: string | null = null,
): WorkStatus[] {
  if (person.role === 'QA') {
    if (status === 'IN_TEST' && reviewer === person.id) return ['READY', 'IN_PROGRESS'];
    if (status === 'READY') return ['IN_PROGRESS'];
  }
  if (person.role !== 'ENGINEER') return [];
  if (status === 'TO_DO' && (!assignee || person.id === assignee)) return ['IN_PROGRESS'];
  if (status === 'IN_PROGRESS' && person.id === assignee) return ['IN_TEST'];
  return [];
}
