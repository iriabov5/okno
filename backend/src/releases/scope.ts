import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { bad, conflict } from '../common/errors.js';
import { rows } from '../database/database.js';
import type { WorkStatus } from '../tracker/rules.js';

interface ScopeItem {
  id: string;
  key: string;
  title: string;
  status: WorkStatus;
  assignee: string | null;
  requiredKey: string | null;
  requiredRelease: string | null;
  deployedRelease: string | null;
}

const invalidItems = () =>
  bad('Проверьте номера задач и их принадлежность системе.', 'INVALID_RELEASE_ITEMS');

export function normalizeKeys(keys: string[]): string[] {
  const normalized = keys
    .map((key) => key.trim().toUpperCase())
    .sort((left, right) => left.localeCompare(right, 'en'));
  if (normalized.some((key) => !key) || new Set(normalized).size !== normalized.length)
    invalidItems();
  return normalized;
}

interface ScopeBlocker {
  key: string | null;
  code: string;
  status?: WorkStatus;
  assignee?: string | null;
  message: string;
}

const readinessMessages = {
  TO_DO: 'Работа над задачей ещё не началась.',
  IN_PROGRESS: 'Задача ещё в работе.',
  IN_TEST: 'Задача ещё не прошла проверку.',
};

function readinessBlocker(item: ScopeItem): ScopeBlocker | undefined {
  const { key, status, assignee, deployedRelease } = item;
  if (deployedRelease) {
    return {
      key,
      status,
      assignee,
      code: 'ALREADY_DEPLOYED',
      message: 'Уже внедрена в ' + deployedRelease + '.',
    };
  }
  if (status !== 'READY')
    return { key, status, assignee, code: 'NOT_READY', message: readinessMessages[status] };
}

export function scopeFindings(items: ScopeItem[], allowEmpty = false) {
  const keys = new Set(items.map((item) => item.key));
  const blockers: ScopeBlocker[] = [];
  const dependencies: {
    key: string;
    requiredKey: string;
    release: string | null;
    included: boolean;
  }[] = [];
  if (!items.length && !allowEmpty) {
    blockers.push({ key: null, code: 'EMPTY_SCOPE', message: 'Добавьте хотя бы одну задачу.' });
  }
  for (const item of items) {
    const readiness = readinessBlocker(item);
    if (readiness) blockers.push(readiness);
    const { key, status, assignee, requiredKey, requiredRelease } = item;
    if (!requiredKey) continue;
    const included = keys.has(requiredKey);
    dependencies.push({ key, requiredKey, release: requiredRelease, included });
    if (!included && !requiredRelease) {
      blockers.push({
        key,
        status,
        assignee,
        code: 'MISSING_DEPENDENCY',
        message: 'Требуется задача ' + requiredKey + '.',
      });
    }
  }
  return { blockers, dependencies };
}

@Injectable()
export class ReleaseScope {
  async items(db: EntityManager, systemId: string | null, keys: string[], lock = false) {
    if (!keys.length) return [];
    if (!systemId) invalidItems();
    if (lock) {
      await db.query(
        'SELECT id FROM work_items WHERE system_id=$1 AND key=ANY($2::text[]) ORDER BY id FOR UPDATE',
        [systemId, keys],
      );
    }
    const items = await rows<ScopeItem>(
      db,
      `
      SELECT w.id, w.key, w.title, w.status, u.display_name AS assignee,
        pred.key AS "requiredKey", predRelease.key AS "requiredRelease", actual.key AS "deployedRelease"
      FROM work_items w LEFT JOIN users u ON u.id=w.assignee_id
      LEFT JOIN work_items pred ON pred.id=w.required_item_id
      LEFT JOIN deployed_work_items pd ON pd.item_id=pred.id
      LEFT JOIN release_requests predRelease ON predRelease.id=pd.request_id
      LEFT JOIN deployed_work_items d ON d.item_id=w.id
      LEFT JOIN release_requests actual ON actual.id=d.request_id
      WHERE w.system_id=$1 AND w.key=ANY($2::text[]) ORDER BY w.key
    `,
      [systemId, keys],
    );
    if (items.length !== keys.length) invalidItems();
    return items;
  }

  assertReady(items: ScopeItem[]) {
    const findings = scopeFindings(items);
    if (findings.blockers.length)
      conflict('RELEASE_SCOPE_BLOCKED', 'В составе релиза есть препятствия.', findings);
  }

  async save(db: EntityManager, requestId: string, items: ScopeItem[]) {
    await db.query('DELETE FROM release_request_items WHERE request_id=$1', [requestId]);
    if (!items.length) return;
    await db.query(
      `
      INSERT INTO release_request_items(request_id,item_id,item_key,item_title)
      SELECT $1, x.id, x.key, x.title FROM jsonb_to_recordset($2) AS x(id uuid, key text, title text)
    `,
      [requestId, JSON.stringify(items)],
    );
  }
}
