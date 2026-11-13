import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedTransitions } from '../dist/tracker/rules.js';
import {
  calendarPreview,
  checkedFields,
  routeChanges,
  routeFor,
  releaseLink,
} from '../dist/releases/rules.js';
import { normalizeKeys, scopeFindings } from '../dist/releases/scope.js';

const windowAt = (startsAt, endsAt) => ({
  startsAt: new Date('2026-11-13T' + startsAt + ':00+03:00'),
  endsAt: new Date('2026-11-13T' + endsAt + ':00+03:00'),
});

test('Ночное окно определяется по полуоткрытым границам', () => {
  for (const [start, end, night] of [
    ['21:00', '22:00', false],
    ['21:00', '22:15', true],
    ['05:00', '06:00', true],
    ['06:00', '07:00', false],
  ]) {
    assert.equal(routeFor(windowAt(start, end)).includes('DUTY'), night);
  }
});

test('Предложение использует первую свободную точку и сохраняет длительность', () => {
  const block = { ...windowAt('21:00', '22:07'), resource: 'База', description: 'Работы' };
  const preview = calendarPreview(windowAt('21:00', '21:45'), [block]);
  assert.deepEqual(preview.suggestedWindow, windowAt('22:15', '23:00'));
  assert.deepEqual(calendarPreview(windowAt('22:07', '23:00'), [block]).conflicts, []);
  assert.equal(
    calendarPreview(windowAt('21:00', '22:00'), [
      { ...block, endsAt: new Date('2026-11-16T00:00:00Z') },
    ]).suggestedWindow,
    null,
  );
});

test('Изменение тега отзывает решение владельца, сохраняя согласование времени', () => {
  const candidate = {
    systemId: 'system',
    title: 'Релиз',
    rollbackPlan: 'План',
    itemKeys: ['OKNO-142'],
    gitlabTagUrl: null,
    ...windowAt('21:00', '22:00'),
  };
  const route = routeFor(candidate);
  const approvals = route.map((stage) => ({
    stage,
    id: stage,
    status: 'APPROVED',
    assignee_id: stage,
    invalidated_at_revision: null,
    checked_fields: checkedFields(stage, candidate),
  }));
  const changed = routeChanges(
    route,
    route,
    { ...candidate, gitlabTagUrl: 'https://gitlab.example.ru/team/app/-/tags/v2' },
    approvals,
  );
  assert.equal(changed.next, 'OWNER');
  assert.deepEqual([...changed.valid.keys()], ['OPERATIONS']);
  assert.deepEqual(
    changed.invalid.map((approval) => approval.stage),
    ['OWNER'],
  );
  approvals[0].invalidated_at_revision = 3;
  assert.equal(routeChanges(route, route, candidate, approvals).next, 'OWNER');
});

test('Смена состава оставляет решение эксплуатации действующим', () => {
  const candidate = {
    systemId: 'system',
    title: 'Релиз',
    rollbackPlan: 'План',
    itemKeys: ['OKNO-142'],
    gitlabTagUrl: null,
    ...windowAt('21:00', '22:00'),
  };
  const route = routeFor(candidate);
  const approvals = route.map((stage) => ({
    stage,
    id: stage,
    status: 'APPROVED',
    assignee_id: stage,
    invalidated_at_revision: null,
    checked_fields: checkedFields(stage, candidate),
  }));
  const result = routeChanges(
    route,
    route,
    { ...candidate, itemKeys: ['OKNO-142', 'OKNO-151'] },
    approvals,
  );
  assert.equal(result.next, 'OWNER');
  assert.deepEqual([...result.valid.keys()], ['OPERATIONS']);
});

test('Исполнитель передаёт задачу на проверку, а тестировщик подтверждает её', () => {
  const engineer = { id: 'engineer', role: 'ENGINEER' };
  const qa = { id: 'qa', role: 'QA' };
  assert.deepEqual(allowedTransitions('TO_DO', null, engineer), ['IN_PROGRESS']);
  assert.deepEqual(allowedTransitions('TO_DO', 'other', engineer), []);
  assert.deepEqual(allowedTransitions('TO_DO', null, qa), []);
  assert.deepEqual(allowedTransitions('IN_PROGRESS', engineer.id, engineer), ['IN_TEST']);
  assert.deepEqual(allowedTransitions('IN_PROGRESS', 'other', engineer), []);
  assert.deepEqual(allowedTransitions('IN_TEST', engineer.id, engineer), []);
  assert.deepEqual(allowedTransitions('IN_TEST', engineer.id, qa), []);
  assert.deepEqual(allowedTransitions('IN_TEST', engineer.id, qa, qa.id), ['READY', 'IN_PROGRESS']);
});

test('Неукомплектованный состав показывает обе причины', () => {
  const item = {
    key: 'OKNO-151',
    status: 'IN_TEST',
    assignee: 'Илья',
    requiredKey: 'OKNO-142',
    requiredRelease: null,
    deployedRelease: null,
  };
  assert.deepEqual(
    scopeFindings([item]).blockers.map((entry) => entry.code),
    ['NOT_READY', 'MISSING_DEPENDENCY'],
  );
  assert.deepEqual(
    scopeFindings([{ ...item, status: 'READY', requiredRelease: 'REL-24' }]).blockers,
    [],
  );
  assert.deepEqual(normalizeKeys([' okno-151 ', 'OKNO-142']), ['OKNO-142', 'OKNO-151']);
  assert.throws(() => normalizeKeys(['OKNO-142', 'okno-142']));
});

test('GitLab Release ссылается на тот же проект и тег', () => {
  const tag = 'https://gitlab.example.ru/team/app/-/tags/v1';
  const release = 'https://gitlab.example.ru/team/app/-/releases/v1';
  assert.equal(releaseLink(release, tag), release);
  assert.throws(() => releaseLink(release.replace('/app/', '/another/'), tag));
  assert.throws(() => releaseLink(release.replace('https:', 'http:'), tag));
});
