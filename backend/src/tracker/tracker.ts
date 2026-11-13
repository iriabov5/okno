import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  bad,
  checkRevision,
  conflict,
  forbidden,
  invalidState,
  missing,
} from '../common/errors.js';
import { requestLog } from '../common/logging.js';
import type { Person } from '../common/types.js';
import { first, rows } from '../database/database.js';
import type {
  CreateWorkDto,
  EditWorkDto,
  MoveWorkDto,
  WorkFilterDto,
  WorkType,
  Priority,
} from './dto.js';
import { allowedTransitions, type WorkStatus } from './rules.js';

interface WorkRow {
  id: string;
  key: string;
  system_id: string;
  title: string;
  description: string | null;
  assignee_id: string | null;
  reviewer_id: string | null;
  required_item_id: string | null;
  type: WorkType;
  priority: Priority;
  epic_id: string | null;
  status: WorkStatus;
  revision: number;
  deployed: boolean;
}

interface ReleaseLink {
  id: string | null;
  key: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  deployedAt: string | null;
}

interface WorkCard {
  id: string;
  key: string;
  systemId: string;
  type: WorkType;
  priority: Priority;
  epic: { id: string; title: string } | null;
  sprint: { id: string; name: string; state: string } | null;
  title: string;
  description: string | null;
  status: WorkStatus;
  revision: number;
  assignee: { id: string; displayName: string } | null;
  reviewer: WorkCard['assignee'];
  requiredItem: { id: string; key: string; title: string } | null;
  plannedReleases: ReleaseLink[];
  deployedRelease: ReleaseLink | null;
}

const workSelect = `
  SELECT w.id, w.key, w.system_id AS "systemId", w.title, w.description, w.status, w.revision,
    w.type,w.priority,
    CASE WHEN e.id IS NOT NULL THEN jsonb_build_object('id',e.id,'title',e.title) END AS epic,
    CASE WHEN s.id IS NOT NULL THEN jsonb_build_object('id',s.id,'name',s.name,'state',s.state) END AS sprint,
    CASE WHEN u.id IS NOT NULL THEN jsonb_build_object('id',u.id,'displayName',u.display_name) END AS assignee,
    CASE WHEN reviewer.id IS NOT NULL THEN jsonb_build_object(
      'id',reviewer.id,'displayName',reviewer.display_name) END AS reviewer,
    CASE WHEN predecessor.id IS NOT NULL THEN jsonb_build_object(
      'id',predecessor.id,'key',predecessor.key,'title',predecessor.title) END AS "requiredItem",
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', CASE WHEN rr.author_id = $1 OR EXISTS (
          SELECT 1 FROM approval_tasks a WHERE a.request_id = rr.id AND a.assignee_id = $1
        ) THEN rr.id END,
        'key',rr.key,'status',rr.status,'startsAt',rr.starts_at,'endsAt',rr.ends_at,'deployedAt',rr.deployed_at
      ) ORDER BY (rr.status = 'DRAFT'), rr.starts_at NULLS LAST, rr.key)
      FROM release_request_items rri JOIN release_requests rr ON rr.id = rri.request_id
      WHERE rri.item_id = w.id AND rr.status <> 'DEPLOYED' AND (rr.status <> 'DRAFT' OR rr.author_id = $1)
    ), '[]'::jsonb) AS "plannedReleases",
    (
      SELECT jsonb_build_object(
        'id', CASE WHEN rr.author_id = $1 OR EXISTS (
          SELECT 1 FROM approval_tasks a WHERE a.request_id = rr.id AND a.assignee_id = $1
        ) THEN rr.id END,
        'key',rr.key,'status',rr.status,'startsAt',rr.starts_at,'endsAt',rr.ends_at,'deployedAt',rr.deployed_at
      )
      FROM deployed_work_items d JOIN release_requests rr ON rr.id = d.request_id WHERE d.item_id = w.id
    ) AS "deployedRelease"
  FROM work_items w LEFT JOIN users u ON u.id = w.assignee_id
  LEFT JOIN epics e ON e.id=w.epic_id
  LEFT JOIN sprints s ON s.id=w.sprint_id
  LEFT JOIN users reviewer ON reviewer.id = w.reviewer_id
  LEFT JOIN work_items predecessor ON predecessor.id = w.required_item_id
`;

export function requireEngineer(person: Person): void {
  if (person.role !== 'ENGINEER') forbidden();
}

function withTransitions(item: WorkCard, person: Person) {
  return {
    ...item,
    canClaimReview:
      person.role === 'QA' && item.status === 'IN_TEST' && !item.reviewer && !item.deployedRelease,
    allowedTransitions: item.deployedRelease
      ? []
      : allowedTransitions(
          item.status,
          item.assignee?.id ?? null,
          person,
          item.reviewer?.id ?? null,
        ),
  };
}

@Injectable()
export class TrackerService {
  constructor(private readonly db: DataSource) {}

  async list(person: Person, filters: WorkFilterDto = {}, search = '') {
    const backlog = filters.backlog === 'true';
    if (backlog && filters.sprintId) bad('Выберите спринт или бэклог.');
    const items = await rows<WorkCard>(
      this.db.manager,
      workSelect +
        `
      WHERE ($2::uuid IS NULL OR w.system_id = $2) AND ($3::uuid IS NULL OR w.assignee_id = $3)
        AND (strpos(lower(w.key), lower($4)) > 0 OR strpos(lower(w.title), lower($4)) > 0)
        AND ($5::uuid IS NULL OR w.sprint_id=$5)
        AND ($6::uuid IS NULL OR w.epic_id=$6)
        AND ($7::text IS NULL OR w.type=$7)
        AND (NOT $8::boolean OR (w.sprint_id IS NULL AND NOT EXISTS (
          SELECT 1 FROM deployed_work_items d WHERE d.item_id=w.id
        )))
      ORDER BY w.created_at DESC, w.key DESC
    `,
      [
        person.id,
        filters.systemId ?? null,
        filters.assigneeId ?? null,
        search.trim(),
        filters.sprintId ?? null,
        filters.epicId ?? null,
        filters.type ?? null,
        backlog,
      ],
    );
    return { items: items.map((item) => withTransitions(item, person)) };
  }

  async get(person: Person, id: string) {
    const item = await first<WorkCard>(this.db.manager, workSelect + ' WHERE w.id = $2', [
      person.id,
      id,
    ]);
    if (!item) missing();
    // В старых отправках состав сохранён в снимке владельца из той же транзакции.
    const history = await rows(
      this.db.manager,
      `
      SELECT e.id, e.kind, e.from_status AS "fromStatus", e.to_status AS "toStatus",
        e.occurred_at AS "occurredAt", u.display_name AS actor,
        previous.display_name AS "previousAssignee", next.display_name AS "nextAssignee",
        NULL AS "releaseKey",
        CASE WHEN old_sprint.id IS NOT NULL THEN jsonb_build_object('id',old_sprint.id,'name',old_sprint.name) END AS "fromSprint",
        CASE WHEN new_sprint.id IS NOT NULL THEN jsonb_build_object('id',new_sprint.id,'name',new_sprint.name) END AS "toSprint"
      FROM work_item_events e LEFT JOIN users u ON u.id = e.actor_id
      LEFT JOIN users previous ON previous.id = e.previous_assignee_id
      LEFT JOIN users next ON next.id = e.next_assignee_id
      LEFT JOIN sprints old_sprint ON old_sprint.id=e.from_sprint_id
      LEFT JOIN sprints new_sprint ON new_sprint.id=e.to_sprint_id
      WHERE e.item_id = $1
      UNION ALL
      SELECT e.id, CASE
          WHEN e.type = 'DEPLOYED' THEN 'RELEASE_DEPLOYED'
          WHEN e.type = 'SUBMITTED' THEN 'RELEASE_SUBMITTED'
          WHEN e.details->'addedItemKeys' ? $2 THEN 'RELEASE_ADDED'
          ELSE 'RELEASE_REMOVED'
        END,
        NULL, NULL, CASE WHEN e.type = 'DEPLOYED' THEN r.deployed_at ELSE e.created_at END, u.display_name, NULL, NULL, r.key, NULL, NULL
      FROM release_events e
      JOIN release_requests r ON r.id = e.request_id
      JOIN users u ON u.id = e.actor_id
      WHERE (e.type = 'DEPLOYED' AND EXISTS (
          SELECT 1 FROM deployed_work_items d WHERE d.item_id = $1 AND d.request_id = r.id
        ))
        OR (e.type = 'SUBMITTED' AND (
          e.details->'itemKeys' ? $2
          OR (NOT (e.details ? 'itemKeys') AND EXISTS (
            SELECT 1 FROM approval_tasks a
            WHERE a.request_id = r.id AND a.stage = 'OWNER' AND a.created_at = e.created_at
              AND ((a.checked_fields #>> '{}')::jsonb)->4 ? $2
          ))
        ))
        OR (e.type = 'CHANGED'
          AND (e.details->'addedItemKeys' ? $2 OR e.details->'removedItemKeys' ? $2))
      ORDER BY "occurredAt" DESC, id
    `,
      [id, item.key],
    );
    return { ...withTransitions(item, person), history };
  }

  private async verifyAssignee(db: EntityManager, id: string | null) {
    if (
      id &&
      !(await first(db, "SELECT id FROM users WHERE id = $1 AND role = 'ENGINEER' FOR SHARE", [id]))
    ) {
      bad('Назначить задачу можно инженеру.');
    }
  }

  private async verifyDependency(
    db: EntityManager,
    systemId: string,
    requiredId: string | null,
    itemId: string | null,
  ) {
    if (!requiredId) return;
    const predecessor = await first(
      db,
      'SELECT id FROM work_items WHERE id = $1 AND system_id = $2',
      [requiredId, systemId],
    );
    if (!predecessor)
      bad('Предшествующая задача должна относиться к той же системе.', 'INVALID_DEPENDENCY');
    const cycle = await first(
      db,
      `
      WITH RECURSIVE ancestors AS (
        SELECT id, required_item_id FROM work_items WHERE id = $1
        UNION
        SELECT w.id, w.required_item_id FROM work_items w JOIN ancestors a ON w.id = a.required_item_id
      )
      SELECT id FROM ancestors WHERE id = $2
    `,
      [requiredId, itemId],
    );
    if (cycle) bad('Эта зависимость образует цикл.', 'INVALID_DEPENDENCY');
  }

  private async verifyEpic(db: EntityManager, epicId: string | null, systemId: string) {
    if (!epicId) return;
    const epic = await first<{ system_id: string }>(db, 'SELECT system_id FROM epics WHERE id=$1', [
      epicId,
    ]);
    if (!epic) missing();
    if (epic.system_id !== systemId) bad('Выберите эпик той же системы.', 'EPIC_SYSTEM_MISMATCH');
  }

  async create(person: Person, input: CreateWorkDto) {
    requireEngineer(person);
    const id = await this.db.transaction(async (db) => {
      if (!(await first(db, 'SELECT id FROM systems WHERE id = $1 FOR UPDATE', [input.systemId])))
        missing();
      const title = input.title.trim();
      if (!title) bad('Укажите название задачи.');
      await this.verifyAssignee(db, input.assigneeId ?? null);
      await this.verifyDependency(db, input.systemId, input.requiredItemId ?? null, null);
      await this.verifyEpic(db, input.epicId ?? null, input.systemId);
      const saved = await first<{ id: string }>(
        db,
        `
        INSERT INTO work_items(system_id,title,description,assignee_id,required_item_id,type,priority,epic_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id
      `,
        [
          input.systemId,
          title,
          input.description?.trim() || null,
          input.assigneeId ?? null,
          input.requiredItemId ?? null,
          input.type ?? 'TASK',
          input.priority ?? 'NORMAL',
          input.epicId ?? null,
        ],
      );
      if (!saved) throw new Error('Work item insert returned no row');
      await db.query(
        `INSERT INTO work_item_events(item_id, actor_id, kind, from_status, to_status, next_assignee_id, occurred_at)
         SELECT id, $2, 'CREATED', status, status, assignee_id, created_at FROM work_items WHERE id=$1`,
        [saved.id, person.id],
      );
      return saved.id;
    });
    const item = await this.get(person, id);
    requestLog({ activity: { action: 'TASK_CREATED', key: item.key } });
    return item;
  }

  private async lock(db: EntityManager, id: string) {
    const item = await first<WorkRow>(
      db,
      `
      SELECT w.*, EXISTS (SELECT 1 FROM deployed_work_items d WHERE d.item_id = w.id) AS deployed
      FROM work_items w WHERE w.id = $1 FOR UPDATE OF w
    `,
      [id],
    );
    if (!item) missing();
    // Новая команда видит внедрение, даже если ожидала блокировку строки задачи.
    item.deployed = Boolean(
      await first(db, 'SELECT item_id FROM deployed_work_items WHERE item_id = $1', [id]),
    );
    return item;
  }

  async edit(person: Person, id: string, input: EditWorkDto) {
    requireEngineer(person);
    await this.db.transaction(async (db) => {
      if (input.requiredItemId !== undefined) {
        await db.query(
          'SELECT id FROM systems WHERE id = (SELECT system_id FROM work_items WHERE id = $1) FOR UPDATE',
          [id],
        );
      }
      const item = await this.lock(db, id);
      checkRevision(item.revision, input.expectedRevision);
      if (item.deployed) invalidState();
      const { type, priority, epic } = await this.resolvePlanningEdit(db, item, input);
      const assignee = input.assigneeId === undefined ? item.assignee_id : input.assigneeId;
      if (!assignee && item.status !== 'TO_DO') bad('Задаче в работе нужен исполнитель.');
      const title = input.title === undefined ? item.title : input.title?.trim();
      if (!title) bad('Укажите название задачи.');
      const description =
        input.description === undefined ? item.description : input.description?.trim() || null;
      const dependency =
        input.requiredItemId === undefined ? item.required_item_id : input.requiredItemId;
      if (input.assigneeId !== undefined) await this.verifyAssignee(db, assignee);
      if (input.requiredItemId !== undefined)
        await this.verifyDependency(db, item.system_id, dependency, id);
      if (
        title === item.title &&
        description === item.description &&
        assignee === item.assignee_id &&
        dependency === item.required_item_id &&
        type === item.type &&
        priority === item.priority &&
        epic === item.epic_id
      )
        return;
      await db.query(
        `
        UPDATE work_items SET title=$2, description=$3, assignee_id=$4, required_item_id=$5,
          type=$6, priority=$7, epic_id=$8, revision=revision+1, updated_at=now() WHERE id=$1
      `,
        [id, title, description, assignee, dependency, type, priority, epic],
      );
      await this.recordAssignment(db, item, person, assignee);
    });
    const item = await this.get(person, id);
    requestLog({ activity: { action: 'TASK_EDITED', key: item.key } });
    return item;
  }

  private async resolvePlanningEdit(db: EntityManager, item: WorkRow, input: EditWorkDto) {
    const editsDetails =
      input.title !== undefined ||
      input.description !== undefined ||
      input.requiredItemId !== undefined ||
      input.type !== undefined ||
      input.priority !== undefined ||
      input.epicId !== undefined;
    if (editsDetails && item.status !== 'TO_DO' && item.status !== 'IN_PROGRESS') invalidState();
    if (input.type === null || input.priority === null) bad('Укажите тип и приоритет задачи.');
    const epic = input.epicId === undefined ? item.epic_id : input.epicId;
    if (input.epicId !== undefined) await this.verifyEpic(db, epic, item.system_id);
    return { type: input.type ?? item.type, priority: input.priority ?? item.priority, epic };
  }

  private async recordAssignment(
    db: EntityManager,
    item: WorkRow,
    person: Person,
    assignee: string | null,
  ) {
    if (assignee === item.assignee_id) return;
    await db.query(
      `INSERT INTO work_item_events(item_id, actor_id, kind, from_status, to_status,
        previous_assignee_id, next_assignee_id) VALUES ($1,$2,'ASSIGNMENT',$3,$3,$4,$5)`,
      [item.id, person.id, item.status, item.assignee_id, assignee],
    );
  }

  /**
   * Закрепляет проверку за текущим тестировщиком и записывает событие в историю.
   * Блокировка задачи и ревизия защищают от одновременного взятия двумя людьми.
   */
  async claimReview(person: Person, id: string, expectedRevision: number) {
    if (person.role !== 'QA') forbidden();
    await this.db.transaction(async (db) => {
      if (
        !(await first(db, "SELECT id FROM users WHERE id=$1 AND role='QA' FOR SHARE", [person.id]))
      )
        forbidden();
      const item = await this.lock(db, id);
      checkRevision(item.revision, expectedRevision);
      if (item.deployed || item.status !== 'IN_TEST') invalidState();
      if (item.reviewer_id) conflict('REVIEW_ALREADY_ASSIGNED', 'Задачу уже взяли на проверку.');
      await db.query(
        'UPDATE work_items SET reviewer_id=$2, revision=revision+1, updated_at=now() WHERE id=$1',
        [id, person.id],
      );
      await db.query(
        "INSERT INTO work_item_events(item_id,actor_id,kind,from_status,to_status) VALUES ($1,$2,'REVIEW_CLAIMED','IN_TEST','IN_TEST')",
        [id, person.id],
      );
    });
    const item = await this.get(person, id);
    requestLog({ activity: { action: 'REVIEW_CLAIMED', key: item.key } });
    return item;
  }

  async move(person: Person, id: string, input: MoveWorkDto) {
    const previous = await this.db.transaction(async (db) => {
      const item = await this.lock(db, id);
      checkRevision(item.revision, input.expectedRevision);
      if (item.deployed) invalidState();
      if (
        !allowedTransitions(item.status, item.assignee_id, person, item.reviewer_id).includes(
          input.targetStatus,
        )
      )
        forbidden();
      const assignee = item.assignee_id ?? person.id;
      if (!item.assignee_id) await this.verifyAssignee(db, assignee);
      await db.query(
        `UPDATE work_items SET status=$2, assignee_id=$3,
         reviewer_id=CASE WHEN $2='READY' THEN reviewer_id ELSE NULL END,
         revision=revision+1,updated_at=now() WHERE id=$1`,
        [id, input.targetStatus, assignee],
      );
      await db.query(
        'INSERT INTO work_item_events(item_id,actor_id,from_status,to_status) VALUES ($1,$2,$3,$4)',
        [id, person.id, item.status, input.targetStatus],
      );
      return item;
    });
    requestLog({
      activity: {
        action: 'TASK_STATUS_CHANGED',
        key: previous.key,
        fromStatus: previous.status,
        toStatus: input.targetStatus,
      },
    });
    return this.get(person, id);
  }

  async returnImpact(person: Person, id: string) {
    if (person.role !== 'QA') forbidden();
    const item = await this.get(person, id);
    if (item.status !== 'READY' || item.deployedRelease) invalidState();
    return {
      revision: item.revision,
      releases: item.plannedReleases.filter((link) => link.status !== 'DRAFT'),
    };
  }
}
