import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import {
  bad,
  checkRevision,
  conflict,
  forbidden,
  invalidState,
  missing,
} from '../common/errors.js';
import type { Person } from '../common/types.js';
import { first, rows } from '../database/database.js';
import type {
  CompleteSprintDto,
  CompletionDto,
  CreateEpicDto,
  CreateSprintDto,
  MoveSprintDto,
} from './dto.js';

type SprintState = 'PLANNED' | 'ACTIVE' | 'CLOSED';

interface Sprint {
  id: string;
  name: string;
  startsOn: string;
  state: SprintState;
  revision: number;
  itemCount: number;
  readyCount: number;
  goal: string;
  endsOn: string;
  startedAt: Date | null;
  closedAt: Date | null;
}

interface SprintItem {
  id: string;
  key: string;
  title: string;
  status: string;
}

const sprintSelect = `
  SELECT s.id,s.name,s.goal,s.starts_on::text AS "startsOn",s.ends_on::text AS "endsOn",
    s.state,s.revision,s.started_at AS "startedAt",s.closed_at AS "closedAt",
    counts.total AS "itemCount", counts.ready AS "readyCount"
  FROM sprints s
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS total, count(*) FILTER (WHERE status='READY')::int AS ready
    FROM (
      SELECT w.status FROM work_items w WHERE w.sprint_id=s.id AND s.state<>'CLOSED'
      UNION ALL
      SELECT r.status_at_close FROM sprint_results r WHERE r.sprint_id=s.id AND s.state='CLOSED'
    ) members
  ) counts
`;

const epicSelect = `
  SELECT e.id,e.system_id AS "systemId",e.title,e.goal,
    count(w.id)::int AS "itemCount",
    count(w.id) FILTER (WHERE w.status='READY')::int AS "readyCount"
  FROM epics e LEFT JOIN work_items w ON w.epic_id=e.id
`;

function requirePlanner(person: Person): void {
  if (person.role !== 'ENGINEER' && person.role !== 'ADMIN') forbidden();
}

function required(value: string, message: string): string {
  const result = value.trim();
  if (!result) bad(message);
  return result;
}

@Injectable()
export class PlanningService {
  constructor(private readonly db: DataSource) {}

  async epics(systemId?: string) {
    return {
      items: await rows(
        this.db.manager,
        epicSelect +
          ' WHERE ($1::uuid IS NULL OR e.system_id=$1) GROUP BY e.id ORDER BY e.title,e.id',
        [systemId ?? null],
      ),
    };
  }

  async createEpic(person: Person, input: CreateEpicDto) {
    requirePlanner(person);
    const title = required(input.title, 'Укажите название эпика.');
    const goal = required(input.goal, 'Укажите цель эпика.');
    const epic = await first(
      this.db.manager,
      `
      INSERT INTO epics(system_id,title,goal,created_by)
      SELECT id,$2,$3,$4 FROM systems WHERE id=$1
      RETURNING id,system_id AS "systemId",title,goal,0 AS "itemCount",0 AS "readyCount"
    `,
      [input.systemId, title, goal, person.id],
    );
    if (!epic) missing();
    return epic;
  }

  async sprints() {
    return {
      items: await rows<Sprint>(
        this.db.manager,
        sprintSelect +
          `
      ORDER BY CASE s.state WHEN 'ACTIVE' THEN 0 WHEN 'PLANNED' THEN 1 ELSE 2 END,
        CASE WHEN s.state='PLANNED' THEN s.starts_on END, s.closed_at DESC, s.id
    `,
      ),
    };
  }

  private async sprint(db: EntityManager, id: string) {
    const sprint = await first<Sprint>(db, sprintSelect + ' WHERE s.id=$1', [id]);
    if (!sprint) missing();
    return sprint;
  }

  async createSprint(person: Person, input: CreateSprintDto) {
    requirePlanner(person);
    if (input.startsOn > input.endsOn) bad('Дата окончания должна быть не раньше даты начала.');
    const name = required(input.name, 'Укажите название спринта.');
    const goal = required(input.goal, 'Укажите цель спринта.');
    return this.db.transaction(async (db) => {
      const [created] = await rows<{ id: string }>(
        db,
        `
        INSERT INTO sprints(name,goal,starts_on,ends_on,created_by)
        VALUES ($1,$2,$3,$4,$5) RETURNING id
      `,
        [name, goal, input.startsOn, input.endsOn, person.id],
      );
      if (!created) throw new Error('Sprint insert returned no row');
      return this.sprint(db, created.id);
    });
  }

  private change<T>(person: Person, run: (db: EntityManager) => Promise<T>): Promise<T> {
    requirePlanner(person);
    return this.db.transaction(async (db) => {
      // Общая доска использует одну очередь изменений состава и состояния спринтов.
      await db.query('LOCK TABLE sprints IN SHARE ROW EXCLUSIVE MODE');
      return run(db);
    });
  }

  start(person: Person, id: string, expectedRevision: number) {
    return this.change(person, async (db) => {
      const sprint = await this.sprint(db, id);
      checkRevision(sprint.revision, expectedRevision);
      if (sprint.state !== 'PLANNED') invalidState();
      if (await first(db, "SELECT id FROM sprints WHERE state='ACTIVE'"))
        conflict('ACTIVE_SPRINT_EXISTS', 'Сначала завершите активный спринт.');
      if (!sprint.itemCount) conflict('SPRINT_EMPTY', 'Добавьте хотя бы одну карточку.');
      await db.query(
        "UPDATE sprints SET state='ACTIVE',started_at=now(),revision=revision+1 WHERE id=$1",
        [id],
      );
      return this.sprint(db, id);
    });
  }

  private async transfer(
    db: EntityManager,
    person: Person,
    itemIds: string[],
    destination: string | null,
  ) {
    if (!itemIds.length) return;
    await db.query(
      `
      INSERT INTO work_item_events(item_id,actor_id,kind,from_status,to_status,from_sprint_id,to_sprint_id)
      SELECT id,$2,'SPRINT_CHANGED',status,status,sprint_id,$3 FROM work_items WHERE id=ANY($1::uuid[])
    `,
      [itemIds, person.id, destination],
    );
    await db.query(
      `
      UPDATE work_items SET sprint_id=$2,revision=revision+1,updated_at=now() WHERE id=ANY($1::uuid[])
    `,
      [itemIds, destination],
    );
  }

  async move(person: Person, id: string, input: MoveSprintDto) {
    await this.change(person, async (db) => {
      const item = await first<{ sprint_id: string | null; status: string; revision: number }>(
        db,
        'SELECT sprint_id,status,revision FROM work_items WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!item) missing();
      checkRevision(item.revision, input.expectedRevision);
      if (item.sprint_id === input.sprintId) return;
      if (await first(db, 'SELECT item_id FROM deployed_work_items WHERE item_id=$1', [id]))
        invalidState();
      if (
        item.sprint_id &&
        item.status === 'READY' &&
        (await this.sprint(db, item.sprint_id)).state === 'CLOSED'
      )
        invalidState();
      if (input.sprintId && (await this.sprint(db, input.sprintId)).state === 'CLOSED')
        invalidState();
      await this.transfer(db, person, [id], input.sprintId);
      await db.query('UPDATE sprints SET revision=revision+1 WHERE id=ANY($1::uuid[])', [
        [item.sprint_id, input.sprintId].filter(Boolean),
      ]);
    });
  }

  private async warnings(
    db: EntityManager,
    person: Person,
    ids: string[],
    destination: Sprint | null,
  ) {
    return rows(
      db,
      `
      WITH reasons AS (
        SELECT w.key AS "itemKey", r.key AS "releaseKey", r.starts_at AS "releaseStartsAt",
          CASE WHEN r.author_id=$1 OR EXISTS (
            SELECT 1 FROM approval_tasks a WHERE a.request_id=r.id AND a.assignee_id=$1
          ) THEN r.id END AS "releaseId",
          CASE WHEN listed.item_id=w.id THEN
            CASE WHEN $3::date IS NULL THEN 'MOVED_TO_BACKLOG'
              WHEN $3::date > (r.starts_at AT TIME ZONE 'Europe/Moscow')::date THEN 'MOVED_AFTER_RELEASE'
            END
          ELSE 'DEPENDENCY_MOVED' END AS reason,
          CASE WHEN scope.id <> w.id THEN scope.key END AS dependent_key
        FROM work_items w
        JOIN work_items scope ON scope.id=w.id OR scope.required_item_id=w.id
        JOIN release_request_items listed ON listed.item_id=scope.id
        JOIN release_requests r ON r.id=listed.request_id
        WHERE w.id=ANY($2::uuid[]) AND r.status<>'DEPLOYED'
          AND (r.status<>'DRAFT' OR r.author_id=$1)
      )
      SELECT "itemKey","releaseKey","releaseId","releaseStartsAt",
        array_agg(DISTINCT reason ORDER BY reason) AS reasons,
        COALESCE(array_agg(DISTINCT dependent_key ORDER BY dependent_key)
          FILTER (WHERE dependent_key IS NOT NULL), ARRAY[]::text[]) AS "dependentKeys"
      FROM reasons WHERE reason IS NOT NULL
      GROUP BY "itemKey","releaseKey","releaseId","releaseStartsAt"
      ORDER BY "releaseKey","itemKey"
    `,
      [person.id, ids, destination?.startsOn ?? null],
    );
  }

  private async previewData(
    db: EntityManager,
    person: Person,
    id: string,
    input: CompletionDto,
    lock: boolean,
  ) {
    const sprint = await this.sprint(db, id);
    checkRevision(sprint.revision, input.expectedRevision);
    if (sprint.state !== 'ACTIVE') invalidState();
    const destination = input.destinationSprintId
      ? await this.sprint(db, input.destinationSprintId)
      : null;
    if (destination && destination.state !== 'PLANNED') invalidState();

    const items = await rows<SprintItem>(
      db,
      `
      SELECT id,key,title,status FROM work_items WHERE sprint_id=$1 ORDER BY key ${lock ? 'FOR UPDATE' : ''}
    `,
      [id],
    );
    if (lock) {
      // После блокировки карточек фиксируем зависимости и данные релизов.
      await db
        .query(
          'LOCK TABLE work_items, release_requests, release_request_items, approval_tasks IN SHARE MODE NOWAIT',
        )
        .catch((error: { code?: string }) => {
          if (error.code === '55P03')
            conflict('PREVIEW_CHANGED', 'План выпуска меняется. Обновите предпросмотр.');
          throw error;
        });
    }
    const readyItems = items.filter((item) => item.status === 'READY');
    const movingItems = items.filter((item) => item.status !== 'READY');
    const warnings = await this.warnings(
      db,
      person,
      movingItems.map((item) => item.id),
      destination,
    );
    const previewToken = createHash('sha256')
      .update(
        JSON.stringify([
          person.id,
          id,
          sprint.revision,
          destination?.id,
          destination?.startsOn,
          items,
          warnings,
        ]),
      )
      .digest('hex');
    return { readyItems, movingItems, warnings, previewToken };
  }

  preview(person: Person, id: string, input: CompletionDto) {
    requirePlanner(person);
    return this.db.transaction('REPEATABLE READ', (db) =>
      this.previewData(db, person, id, input, false),
    );
  }

  complete(person: Person, id: string, input: CompleteSprintDto) {
    return this.change(person, async (db) => {
      const preview = await this.previewData(db, person, id, input, true);
      if (preview.previewToken !== input.previewToken)
        conflict('PREVIEW_CHANGED', 'План изменился. Обновите предпросмотр.');
      await db.query(
        `
        INSERT INTO sprint_results(sprint_id,work_item_id,status_at_close,destination_sprint_id)
        SELECT $1,id,status,CASE WHEN status='READY' THEN NULL ELSE $2::uuid END FROM work_items WHERE sprint_id=$1
      `,
        [id, input.destinationSprintId],
      );
      await this.transfer(
        db,
        person,
        preview.movingItems.map((item) => item.id),
        input.destinationSprintId,
      );
      if (input.destinationSprintId && preview.movingItems.length)
        await db.query('UPDATE sprints SET revision=revision+1 WHERE id=$1', [
          input.destinationSprintId,
        ]);
      await db.query(
        "UPDATE sprints SET state='CLOSED',closed_at=now(),revision=revision+1 WHERE id=$1",
        [id],
      );
      return this.sprint(db, id);
    });
  }

  async results(id: string) {
    if ((await this.sprint(this.db.manager, id)).state !== 'CLOSED') invalidState();
    return {
      items: await rows(
        this.db.manager,
        `
      SELECT w.id,w.key,w.title,r.status_at_close AS "statusAtClose",
        r.destination_sprint_id AS "destinationSprintId"
      FROM sprint_results r JOIN work_items w ON w.id=r.work_item_id WHERE r.sprint_id=$1 ORDER BY w.key
    `,
        [id],
      ),
    };
  }
}
