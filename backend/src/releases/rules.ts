import { bad } from '../common/errors.js';

const hour = 3_600_000;
const day = 24 * hour;
const step = 15 * 60_000;
const moscowOffset = 3 * hour;
export const stages = ['OWNER', 'OPERATIONS', 'DUTY'] as const;
export type Stage = (typeof stages)[number];
export type ReleaseStatus = 'DRAFT' | 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'DEPLOYED';
export type TaskStatus = 'ACTIVE' | 'APPROVED' | 'RETURNED' | 'CANCELLED';

export const stageLabels: Record<Stage, string> = {
  OWNER: 'Владелец системы',
  OPERATIONS: 'Эксплуатация',
  DUTY: 'Дежурный',
};

export interface Window {
  startsAt: Date;
  endsAt: Date;
}
export interface CalendarBlock extends Window {
  resource: string;
  description: string;
}
export interface Candidate {
  systemId: string | null;
  title: string | null;
  rollbackPlan: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  itemKeys: string[];
  gitlabTagUrl: string | null;
}
export interface Approval {
  id: string;
  stage: Stage;
  status: TaskStatus;
  assignee_id: string;
  checked_fields: string;
  invalidated_at_revision: number | null;
}

export function overlaps(a: Window, b: Window): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/** Ночная часть окна определяется по московскому времени и полуоткрытым границам. */
export function routeFor(window?: Window): Stage[] {
  if (!window) return ['OWNER', 'OPERATIONS'];
  const start = window.startsAt.getTime();
  const local = (((start + moscowOffset) % day) + day) % day;
  const touchesNight =
    local < 6 * hour || local >= 22 * hour || window.endsAt.getTime() - start > 22 * hour - local;
  return touchesNight ? [...stages] : ['OWNER', 'OPERATIONS'];
}

export function calendarPreview(window: Window, blocks: CalendarBlock[]) {
  const conflicts = blocks.filter((block) => overlaps(window, block));
  if (!conflicts.length) return { conflicts, suggestedWindow: null };
  const start = window.startsAt.getTime();
  const duration = window.endsAt.getTime() - start;
  for (let time = Math.ceil(start / step) * step; time <= start + 2 * day; time += step) {
    const candidate = { startsAt: new Date(time), endsAt: new Date(time + duration) };
    if (!blocks.some((block) => overlaps(candidate, block))) {
      return { conflicts, suggestedWindow: candidate };
    }
  }
  return { conflicts, suggestedWindow: null };
}

export function checkedFields(stage: Stage, candidate: Candidate): string {
  const fields =
    stage === 'OWNER'
      ? [
          candidate.systemId,
          candidate.title,
          candidate.rollbackPlan,
          candidate.gitlabTagUrl,
          candidate.itemKeys,
        ]
      : [candidate.systemId, candidate.startsAt?.toISOString(), candidate.endsAt?.toISOString()];
  return JSON.stringify(fields);
}

export function routeChanges(
  previous: Stage[],
  route: Stage[],
  candidate: Candidate,
  tasks: Approval[],
) {
  const valid = new Map<Stage, Approval>();
  const invalid = tasks.filter((task) => {
    if (task.status !== 'APPROVED' || task.invalidated_at_revision !== null) return false;
    if (!route.includes(task.stage) || task.checked_fields !== checkedFields(task.stage, candidate))
      return true;
    valid.set(task.stage, task);
    return false;
  });
  const next = route.find((stage) => !valid.has(stage));
  const active = tasks.find((task) => task.status === 'ACTIVE');
  const keepActive =
    active?.stage === next && active?.checked_fields === (next && checkedFields(next, candidate))
      ? active
      : undefined;
  const steps = [...route, ...previous.filter((stage) => !route.includes(stage))].map((stage) => {
    if (!route.includes(stage))
      return { stage, effect: 'REMOVE', reason: 'Дежурный требуется только для ночного окна.' };
    if (valid.has(stage))
      return { stage, effect: 'KEEP', reason: 'Согласованные данные сохранились.' };
    if (keepActive?.stage === stage)
      return { stage, effect: 'KEEP', reason: 'Текущая задача согласования сохраняется.' };
    if (!previous.includes(stage))
      return { stage, effect: 'ADD', reason: 'Новое окно затрагивает ночное время.' };
    if (invalid.some((task) => task.stage === stage) || active?.stage === stage) {
      return {
        stage,
        effect: 'RECHECK',
        reason:
          stage === 'OWNER'
            ? 'Изменились данные, которые проверяет владелец.'
            : 'Изменилось окно или очередность проверки.',
      };
    }
    return { stage, effect: 'PENDING', reason: 'Этап ожидает решения.' };
  });
  return { valid, invalid, next, active, keepActive, steps };
}

export function validateGitLabLink(raw: string | null, kind: 'tags' | 'releases') {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    bad('Укажите полную HTTPS-ссылку на GitLab.');
  }
  const separator = '/-/' + kind + '/';
  const parts = url.pathname.split(separator);
  const project = parts[0]?.slice(1).split('/') ?? [];
  const ref = parts[1];
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    parts.length !== 2 ||
    project.length < 2 ||
    project.some((segment) => !segment) ||
    !ref ||
    ref.endsWith('/')
  ) {
    bad(
      kind === 'tags'
        ? 'Укажите HTTPS-ссылку на тег GitLab.'
        : 'Укажите HTTPS-ссылку на GitLab Release.',
    );
  }
  let decodedRef: string;
  try {
    decodedRef = decodeURIComponent(ref);
  } catch {
    bad('Проверьте имя тега в ссылке GitLab.');
  }
  return { url: url.href, project: url.origin + parts[0], ref: decodedRef };
}

export function releaseLink(raw: string | null, tagUrl: string | null): string | null {
  const release = validateGitLabLink(raw, 'releases');
  const tag = validateGitLabLink(tagUrl, 'tags');
  if (release && tag && (release.project !== tag.project || release.ref !== tag.ref)) {
    bad('Ссылка на GitLab Release должна вести к согласованному тегу того же проекта.');
  }
  return release?.url ?? null;
}
