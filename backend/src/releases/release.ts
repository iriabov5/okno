import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { bad, checkRevision, forbidden, invalidState, missing } from '../common/errors.js';
import { requestLog } from '../common/logging.js';
import type { Person, SystemRow } from '../common/types.js';
import { first, rows } from '../database/database.js';
import { requireEngineer } from '../tracker/tracker.js';
import { checkedWindow, ReleaseCalendar } from './calendar.js';
import type {
  AttachReleaseDto,
  ChangeDto,
  DecisionDto,
  DeployDto,
  DraftDto,
  PatchDraftDto,
  WindowDto,
} from './dto.js';
import {
  checkedFields,
  releaseLink,
  routeChanges,
  routeFor,
  stageLabels,
  validateGitLabLink,
  type Approval,
  type Candidate,
  type ReleaseStatus,
  type Stage,
} from './rules.js';
import { normalizeKeys, ReleaseScope, scopeFindings } from './scope.js';

interface RequestRow {
  id: string;
  key: string;
  author_id: string;
  system_id: string | null;
  title: string | null;
  rollback_plan: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  status: ReleaseStatus;
  revision: number;
  template_version: number | null;
  gitlab_tag_url: string | null;
  gitlab_release_url: string | null;
  deployed_at: Date | null;
}

interface SavedItem {
  sprint: { id: string; name: string; state: string } | null;
  key: string;
  title: string;
}

const requestColumns = `r.id,r.key,r.title,r.status,r.revision,
  r.starts_at AS "startsAt",r.ends_at AS "endsAt",r.deployed_at AS "deployedAt",
  s.name AS "systemName"`;

function windowOf(candidate: Candidate) {
  if (candidate.startsAt && candidate.endsAt)
    return checkedWindow(candidate.startsAt, candidate.endsAt);
}

function responsible(system: SystemRow, stage: Stage): string {
  return { OWNER: system.owner_id, OPERATIONS: system.operations_id, DUTY: system.duty_id }[stage];
}

function requestCandidate(row: RequestRow, itemKeys: string[]): Candidate {
  return {
    systemId: row.system_id,
    title: row.title,
    rollbackPlan: row.rollback_plan,
    itemKeys,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    gitlabTagUrl: row.gitlab_tag_url,
  };
}

function mergeDate(previous: Date | null, input?: string | null) {
  if (input === undefined) return previous;
  return input ? new Date(input) : null;
}

function stageState(stage: Stage, tasks: Approval[], active?: Approval) {
  const stageTasks = tasks.filter((task) => task.stage === stage);
  if (
    stageTasks.some((task) => task.status === 'APPROVED' && task.invalidated_at_revision === null)
  )
    return 'APPROVED';
  const repeated = stageTasks.some(
    (task) =>
      task.invalidated_at_revision !== null ||
      task.status === 'CANCELLED' ||
      task.status === 'RETURNED',
  );
  if (active?.stage === stage) return repeated ? 'RECHECK' : 'ACTIVE';
  return repeated ? 'PENDING_RECHECK' : 'PENDING';
}

function availableActions(row: RequestRow, person: Person, blocked: boolean, active?: Approval) {
  if (active?.assignee_id === person.id) return ['APPROVE', 'RETURN'];
  if (row.author_id !== person.id) return [];
  switch (row.status) {
    case 'DRAFT':
    case 'CHANGES_REQUESTED':
      return ['EDIT', 'SUBMIT'];
    case 'IN_REVIEW':
      return ['CHANGE'];
    case 'APPROVED':
      return blocked ? ['CHANGE'] : ['CHANGE', 'DEPLOY'];
    case 'DEPLOYED':
      return ['ATTACH_RELEASE'];
  }
}

function mergeCandidate(current: Candidate, input: DraftDto): Candidate {
  const systemId = input.systemId === undefined ? current.systemId : input.systemId;
  const previousItems = systemId === current.systemId ? current.itemKeys : [];
  return {
    systemId,
    title: input.title === undefined ? current.title : input.title?.trim() || null,
    rollbackPlan:
      input.rollbackPlan === undefined ? current.rollbackPlan : input.rollbackPlan?.trim() || null,
    startsAt: mergeDate(current.startsAt, input.startsAt),
    endsAt: mergeDate(current.endsAt, input.endsAt),
    itemKeys: input.itemKeys === undefined ? previousItems : normalizeKeys(input.itemKeys),
    gitlabTagUrl:
      input.gitlabTagUrl === undefined
        ? current.gitlabTagUrl
        : (validateGitLabLink(input.gitlabTagUrl?.trim() || null, 'tags')?.url ?? null),
  };
}

function sameCandidate(previous: Candidate, next: Candidate): boolean {
  return (
    previous.systemId === next.systemId &&
    previous.title === next.title &&
    previous.rollbackPlan === next.rollbackPlan &&
    previous.gitlabTagUrl === next.gitlabTagUrl &&
    previous.startsAt?.getTime() === next.startsAt?.getTime() &&
    previous.endsAt?.getTime() === next.endsAt?.getTime() &&
    previous.itemKeys.length === next.itemKeys.length &&
    previous.itemKeys.every((key, index) => key === next.itemKeys[index])
  );
}

function assertComplete(candidate: Candidate) {
  const window = windowOf(candidate);
  if (!candidate.systemId || !candidate.title || !candidate.rollbackPlan || !window) {
    bad('Укажите систему, название, окно внедрения и план отката.');
  }
  return { systemId: candidate.systemId, window };
}

@Injectable()
export class ReleaseService {
  constructor(
    private readonly db: DataSource,
    private readonly scope: ReleaseScope,
    private readonly calendar: ReleaseCalendar,
  ) {}

  private async system(db: EntityManager, id: string) {
    const system = await first<SystemRow>(db, 'SELECT * FROM systems WHERE id=$1', [id]);
    return system ?? missing();
  }

  systems() {
    return rows(this.db.manager, 'SELECT id,code,name FROM systems ORDER BY name').then(
      (items) => ({ items }),
    );
  }

  async previewWindow(person: Person, input: WindowDto) {
    requireEngineer(person);
    await this.system(this.db.manager, input.systemId);
    const window = checkedWindow(new Date(input.startsAt), new Date(input.endsAt));
    const result = await this.calendar.preview(this.db.manager, input.systemId, window);
    return {
      ...result,
      route: routeFor(window),
      suggestedRoute: result.suggestedWindow ? routeFor(result.suggestedWindow) : [],
    };
  }

  async previewScope(person: Person, id: string, keys: string[]) {
    requireEngineer(person);
    await this.system(this.db.manager, id);
    return scopeFindings(await this.scope.items(this.db.manager, id, normalizeKeys(keys)), true);
  }

  private async request(db: EntityManager, id: string, lock = false) {
    const row = await first<RequestRow>(
      db,
      'SELECT * FROM release_requests WHERE id=$1' + (lock ? ' FOR UPDATE' : ''),
      [id],
    );
    return row ?? missing();
  }

  private async snapshots(db: EntityManager, id: string) {
    return rows<SavedItem>(
      db,
      `SELECT ri.item_key AS key, ri.item_title AS title,
        CASE WHEN s.id IS NOT NULL THEN jsonb_build_object('id',s.id,'name',s.name,'state',s.state) END AS sprint
        FROM release_request_items ri JOIN work_items w ON w.id=ri.item_id
        LEFT JOIN sprints s ON s.id=w.sprint_id WHERE ri.request_id=$1 ORDER BY ri.item_key`,
      [id],
    );
  }

  private async approvals(db: EntityManager, id: string) {
    return rows<Approval>(
      db,
      'SELECT * FROM approval_tasks WHERE request_id=$1 ORDER BY created_at,id',
      [id],
    );
  }

  private async mayRead(db: EntityManager, row: RequestRow, person: Person) {
    if (row.author_id === person.id) return;
    if (
      row.status === 'DRAFT' ||
      !(await first(
        db,
        'SELECT id FROM approval_tasks WHERE request_id=$1 AND assignee_id=$2 LIMIT 1',
        [row.id, person.id],
      ))
    )
      missing();
  }

  private async owned(
    db: EntityManager,
    id: string,
    person: Person,
    expectedRevision: number,
    lock = true,
  ) {
    const row = await this.request(db, id, lock);
    await this.mayRead(db, row, person);
    if (row.author_id !== person.id) forbidden();
    checkRevision(row.revision, expectedRevision);
    return row;
  }

  async list(person: Person) {
    return {
      items: await rows(
        this.db.manager,
        `
      SELECT ${requestColumns} FROM release_requests r LEFT JOIN systems s ON s.id=r.system_id
      WHERE r.author_id=$1 ORDER BY r.updated_at DESC,r.key
    `,
        [person.id],
      ),
    };
  }

  async queue(person: Person) {
    return {
      items: await rows(
        this.db.manager,
        `
      SELECT t.id AS "taskId",t.stage,${requestColumns}
      FROM approval_tasks t JOIN release_requests r ON r.id=t.request_id LEFT JOIN systems s ON s.id=r.system_id
      WHERE t.assignee_id=$1 AND t.status='ACTIVE' ORDER BY t.created_at,t.id
    `,
        [person.id],
      ),
    };
  }

  async card(person: Person, id: string) {
    return this.db.transaction('REPEATABLE READ', async (db) => {
      const row = await this.request(db, id);
      await this.mayRead(db, row, person);
      const items = await this.snapshots(db, id);
      const candidate = requestCandidate(
        row,
        items.map((item) => item.key),
      );
      const window = windowOf(candidate);
      const system = row.system_id ? await this.system(db, row.system_id) : null;
      const tasks = await this.approvals(db, id);
      const active = tasks.find((task) => task.status === 'ACTIVE');
      const route = routeFor(window);
      const scope =
        row.status !== 'DEPLOYED'
          ? scopeFindings(
              await this.scope.items(db, row.system_id, candidate.itemKeys),
              row.status === 'DRAFT',
            )
          : { blockers: [], dependencies: [] };
      const calendar =
        window && system && row.status !== 'DEPLOYED'
          ? await this.calendar.preview(db, system.id, window)
          : null;
      const people = await rows<{ id: string; displayName: string }>(
        db,
        'SELECT id,display_name AS "displayName" FROM users WHERE id=ANY($1::uuid[])',
        [[row.author_id, ...(system ? route.map((stage) => responsible(system, stage)) : [])]],
      );
      const personById = (userId: string) => people.find((entry) => entry.id === userId) ?? null;
      const history = await rows(
        db,
        `
        SELECT e.created_at AS "createdAt",e.type,e.details,u.display_name AS actor
        FROM release_events e JOIN users u ON u.id=e.actor_id WHERE e.request_id=$1 ORDER BY e.revision DESC
      `,
        [id],
      );
      return {
        id,
        key: row.key,
        revision: row.revision,
        status: row.status,
        author: personById(row.author_id),
        system: system ? { id: system.id, code: system.code, name: system.name } : null,
        title: row.title,
        rollbackPlan: row.rollback_plan,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        gitlabTagUrl: row.gitlab_tag_url,
        gitlabReleaseUrl: row.gitlab_release_url,
        deployedAt: row.deployed_at,
        items,
        ...scope,
        calendarConflicts: calendar?.conflicts ?? [],
        suggestedWindow: calendar?.suggestedWindow ?? null,
        currentAssignee: active ? personById(active.assignee_id) : null,
        currentTaskId: active?.assignee_id === person.id ? active.id : null,
        route: route.map((stage) => ({
          stage,
          label: stageLabels[stage],
          state: stageState(stage, tasks, active),
          assignee: system ? personById(responsible(system, stage)) : null,
        })),
        history,
        availableActions: availableActions(row, person, scope.blockers.length > 0, active),
      };
    });
  }

  private async event(
    db: EntityManager,
    row: RequestRow,
    person: Person,
    type: string,
    details: object,
    revision = row.revision + 1,
  ) {
    await db.query(
      'INSERT INTO release_events(request_id,actor_id,revision,type,details) VALUES ($1,$2,$3,$4,$5)',
      [row.id, person.id, revision, type, JSON.stringify(details)],
    );
    requestLog({ activity: { action: 'RELEASE_' + type, key: row.key } });
  }

  private async storeDraft(
    db: EntityManager,
    id: string,
    candidate: Candidate,
    status: ReleaseStatus,
    templateVersion: number | null,
  ) {
    await db.query(
      `
      UPDATE release_requests SET system_id=$2,title=$3,rollback_plan=$4,starts_at=$5,ends_at=$6,
        gitlab_tag_url=$7,status=$8,template_version=$9,revision=revision+1,updated_at=now() WHERE id=$1
    `,
      [
        id,
        candidate.systemId,
        candidate.title,
        candidate.rollbackPlan,
        candidate.startsAt,
        candidate.endsAt,
        candidate.gitlabTagUrl,
        status,
        templateVersion,
      ],
    );
  }

  async create(person: Person, input: DraftDto) {
    requireEngineer(person);
    const id = await this.db.transaction(async (db) => {
      const candidate = mergeCandidate(
        {
          systemId: null,
          title: null,
          rollbackPlan: null,
          startsAt: null,
          endsAt: null,
          gitlabTagUrl: null,
          itemKeys: [],
        },
        input,
      );
      if (candidate.systemId) await this.system(db, candidate.systemId);
      windowOf(candidate);
      const items = await this.scope.items(db, candidate.systemId, candidate.itemKeys);
      const row = await first<RequestRow>(
        db,
        `
        INSERT INTO release_requests(author_id,system_id,title,rollback_plan,starts_at,ends_at,gitlab_tag_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
      `,
        [
          person.id,
          candidate.systemId,
          candidate.title,
          candidate.rollbackPlan,
          candidate.startsAt,
          candidate.endsAt,
          candidate.gitlabTagUrl,
        ],
      );
      if (!row) throw new Error('Release request insert returned no row');
      await this.scope.save(db, row.id, items);
      await this.event(db, row, person, 'CREATED', {}, row.revision);
      return row.id;
    });
    return this.card(person, id);
  }

  async edit(person: Person, id: string, input: PatchDraftDto) {
    await this.db.transaction(async (db) => {
      const row = await this.owned(db, id, person, input.expectedRevision);
      if (row.status !== 'DRAFT' && row.status !== 'CHANGES_REQUESTED') invalidState();
      if (
        row.status !== 'DRAFT' &&
        input.systemId !== undefined &&
        input.systemId !== row.system_id
      )
        invalidState();
      const current = requestCandidate(
        row,
        (await this.snapshots(db, id)).map((item) => item.key),
      );
      const candidate = mergeCandidate(current, input);
      if (sameCandidate(current, candidate)) return;
      if (candidate.systemId) await this.system(db, candidate.systemId);
      windowOf(candidate);
      const items = await this.scope.items(db, candidate.systemId, candidate.itemKeys);
      await this.scope.save(db, id, items);
      await this.storeDraft(db, id, candidate, row.status, row.template_version);
      await this.event(db, row, person, 'DRAFT_EDITED', {});
    });
    return this.card(person, id);
  }

  private async reconcile(
    db: EntityManager,
    row: RequestRow,
    system: SystemRow,
    candidate: Candidate,
    tasks: Approval[],
    previous: Stage[],
  ) {
    const route = routeFor(windowOf(candidate));
    const result = routeChanges(previous, route, candidate, tasks);
    for (const task of result.invalid) {
      await db.query('UPDATE approval_tasks SET invalidated_at_revision=$2 WHERE id=$1', [
        task.id,
        row.revision + 1,
      ]);
    }
    if (result.active && !result.keepActive) {
      await db.query("UPDATE approval_tasks SET status='CANCELLED',closed_at=now() WHERE id=$1", [
        result.active.id,
      ]);
    }
    if (result.next && !result.keepActive) {
      await db.query(
        'INSERT INTO approval_tasks(request_id,assignee_id,stage,checked_fields) VALUES ($1,$2,$3,$4)',
        [
          row.id,
          responsible(system, result.next),
          result.next,
          JSON.stringify(checkedFields(result.next, candidate)),
        ],
      );
    }
    return result;
  }

  async submit(person: Person, id: string, expectedRevision: number) {
    await this.db.transaction(async (db) => {
      const row = await this.owned(db, id, person, expectedRevision);
      if (row.status !== 'DRAFT' && row.status !== 'CHANGES_REQUESTED') invalidState();
      const candidate = requestCandidate(
        row,
        (await this.snapshots(db, id)).map((item) => item.key),
      );
      const { systemId, window } = assertComplete(candidate);
      const system = await this.system(db, systemId);
      const items = await this.scope.items(db, systemId, candidate.itemKeys, true);
      this.scope.assertReady(items);
      await this.calendar.check(db, systemId, window);
      const result = await this.reconcile(
        db,
        row,
        system,
        candidate,
        await this.approvals(db, id),
        routeFor(window),
      );
      await this.scope.save(db, id, items);
      await this.storeDraft(db, id, candidate, result.next ? 'IN_REVIEW' : 'APPROVED', 1);
      await this.event(db, row, person, 'SUBMITTED', {
        itemKeys: candidate.itemKeys,
        nextStage: result.next,
        steps: result.steps,
      });
    });
    return this.card(person, id);
  }

  private async prepareChange(
    db: EntityManager,
    person: Person,
    id: string,
    input: ChangeDto,
    lock: boolean,
  ) {
    const row = await this.owned(db, id, person, input.expectedRevision, lock);
    if (row.status !== 'IN_REVIEW' && row.status !== 'APPROVED') invalidState();
    const old = requestCandidate(
      row,
      (await this.snapshots(db, id)).map((item) => item.key),
    );
    const proposed = input.proposedChanges;
    if ((proposed.startsAt === undefined) !== (proposed.endsAt === undefined)) {
      bad('Укажите обе границы нового окна.');
    }
    if (
      proposed.startsAt === undefined &&
      proposed.itemKeys === undefined &&
      proposed.gitlabTagUrl === undefined
    ) {
      bad('Укажите новое окно, состав или тег.');
    }
    const candidate = mergeCandidate(old, proposed);
    const { systemId, window } = assertComplete(candidate);
    const system = await this.system(db, systemId);
    const items = await this.scope.items(db, systemId, candidate.itemKeys, lock);
    const approvals = await this.approvals(db, id);
    const previous = routeFor(windowOf(old));
    const result = routeChanges(previous, routeFor(window), candidate, approvals);
    const differences = {
      addedItemKeys: candidate.itemKeys.filter((key) => !old.itemKeys.includes(key)),
      removedItemKeys: old.itemKeys.filter((key) => !candidate.itemKeys.includes(key)),
      previousWindow: windowOf(old),
      window,
      previousTag: old.gitlabTagUrl,
      gitlabTagUrl: candidate.gitlabTagUrl,
    };
    return { row, old, candidate, system, items, approvals, previous, result, differences, window };
  }

  async previewChange(person: Person, id: string, input: ChangeDto) {
    return this.db.transaction('REPEATABLE READ', async (db) => {
      const change = await this.prepareChange(db, person, id, input, false);
      const { row, system, window, result } = change;
      const assignee = result.next
        ? await first(db, 'SELECT id,display_name AS "displayName" FROM users WHERE id=$1', [
            responsible(system, result.next),
          ])
        : null;
      return {
        revision: row.revision,
        ...change.differences,
        ...scopeFindings(change.items),
        calendar: await this.calendar.preview(db, system.id, window),
        steps: result.steps,
        nextAssignee: assignee ?? null,
      };
    });
  }

  async change(person: Person, id: string, input: ChangeDto) {
    await this.db.transaction(async (db) => {
      const data = await this.prepareChange(db, person, id, input, true);
      this.scope.assertReady(data.items);
      await this.calendar.check(db, data.system.id, data.window);
      if (sameCandidate(data.old, data.candidate)) return;
      const result = await this.reconcile(
        db,
        data.row,
        data.system,
        data.candidate,
        data.approvals,
        data.previous,
      );
      await this.scope.save(db, id, data.items);
      await this.storeDraft(db, id, data.candidate, result.next ? 'IN_REVIEW' : 'APPROVED', 1);
      await this.event(db, data.row, person, 'CHANGED', {
        ...data.differences,
        steps: result.steps,
      });
    });
    return this.card(person, id);
  }

  async decide(person: Person, taskId: string, input: DecisionDto) {
    const requestId = await this.db.transaction(async (db) => {
      const reference = await first<{ request_id: string }>(
        db,
        'SELECT request_id FROM approval_tasks WHERE id=$1 AND assignee_id=$2',
        [taskId, person.id],
      );
      if (!reference) missing();
      const row = await this.request(db, reference.request_id, true);
      checkRevision(row.revision, input.expectedRevision);
      const tasks = await this.approvals(db, row.id);
      const task = tasks.find((entry) => entry.id === taskId && entry.status === 'ACTIVE');
      if (!task || row.status !== 'IN_REVIEW') invalidState();
      const candidate = requestCandidate(
        row,
        (await this.snapshots(db, row.id)).map((item) => item.key),
      );
      if (input.decision === 'RETURN') {
        const comment = input.comment?.trim();
        if (!comment) bad('Укажите причину возврата.');
        await db.query(
          "UPDATE approval_tasks SET status='RETURNED',closed_at=now(),comment=$2 WHERE id=$1",
          [taskId, comment],
        );
        await this.storeDraft(db, row.id, candidate, 'CHANGES_REQUESTED', row.template_version);
        await this.event(db, row, person, 'RETURNED', { stage: task.stage, comment });
        return row.id;
      }
      const { systemId, window } = assertComplete(candidate);
      const system = await this.system(db, systemId);
      this.scope.assertReady(await this.scope.items(db, systemId, candidate.itemKeys, true));
      await this.calendar.check(db, systemId, window);
      await db.query("UPDATE approval_tasks SET status='APPROVED',closed_at=now() WHERE id=$1", [
        taskId,
      ]);
      task.status = 'APPROVED';
      const result = await this.reconcile(db, row, system, candidate, tasks, routeFor(window));
      await this.storeDraft(
        db,
        row.id,
        candidate,
        result.next ? 'IN_REVIEW' : 'APPROVED',
        row.template_version,
      );
      await this.event(db, row, person, 'APPROVED', { stage: task.stage, nextStage: result.next });
      return row.id;
    });
    return this.card(person, requestId);
  }

  async deploy(person: Person, id: string, input: DeployDto) {
    await this.db.transaction(async (db) => {
      const row = await this.owned(db, id, person, input.expectedRevision);
      if (row.status !== 'APPROVED') invalidState();
      const candidate = requestCandidate(
        row,
        (await this.snapshots(db, id)).map((item) => item.key),
      );
      const { systemId, window } = assertComplete(candidate);
      const route = routeFor(window);
      if (routeChanges(route, route, candidate, await this.approvals(db, id)).next) invalidState();
      const deployedAt = new Date(input.deployedAt);
      if (
        deployedAt < window.startsAt ||
        deployedAt >= window.endsAt ||
        deployedAt.getTime() > Date.now()
      ) {
        bad('Фактическое время должно быть внутри согласованного окна и уже наступить.');
      }
      const items = await this.scope.items(db, systemId, candidate.itemKeys, true);
      this.scope.assertReady(items);
      const gitlabReleaseUrl = releaseLink(
        input.gitlabReleaseUrl?.trim() || null,
        row.gitlab_tag_url,
      );
      await db.query(
        `
        UPDATE release_requests SET status='DEPLOYED',deployed_at=$2,gitlab_release_url=$3,revision=revision+1,updated_at=now()
        WHERE id=$1
      `,
        [id, deployedAt, gitlabReleaseUrl],
      );
      await db.query(
        'INSERT INTO deployed_work_items(item_id,request_id) SELECT unnest($1::uuid[]),$2',
        [items.map((item) => item.id), id],
      );
      await this.event(db, row, person, 'DEPLOYED', { deployedAt, gitlabReleaseUrl });
    });
    return this.card(person, id);
  }

  async attachRelease(person: Person, id: string, input: AttachReleaseDto) {
    await this.db.transaction(async (db) => {
      const row = await this.owned(db, id, person, input.expectedRevision);
      if (row.status !== 'DEPLOYED') invalidState();
      const link = releaseLink(input.gitlabReleaseUrl.trim(), row.gitlab_tag_url);
      if (!link) bad('Укажите ссылку на GitLab Release.');
      if (link === row.gitlab_release_url) return;
      await db.query(
        'UPDATE release_requests SET gitlab_release_url=$2,revision=revision+1,updated_at=now() WHERE id=$1',
        [id, link],
      );
      await this.event(db, row, person, 'GITLAB_RELEASE_LINKED', {
        previous: row.gitlab_release_url,
        gitlabReleaseUrl: link,
      });
    });
    return this.card(person, id);
  }
}
