import { useEffect, useState, type SubmitEvent } from 'react';
import {
  ArrowRightLeft,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Filter,
  History,
  Plus,
  Timer,
  UserRound,
} from 'lucide-react';
import { api, message } from './api';
import {
  dateLabel,
  windowLabel,
  workLabels,
  typeLabels,
  priorityLabels,
  sprintPeriod,
} from './labels';
import type {
  Person,
  Epic,
  Sprint,
  ReleaseLink,
  ReleaseWorkEventKind,
  System,
  WorkEvent,
  WorkFormData,
  WorkItem,
  WorkStatus,
} from './types';
import { Alert, Modal } from './ui';

const columns = [
  { status: 'TO_DO', icon: Circle },
  { status: 'IN_PROGRESS', icon: Timer },
  { status: 'IN_TEST', icon: ClipboardCheck },
  { status: 'READY', icon: CheckCircle2 },
] as const;

function ReleaseBadge({ item }: Readonly<{ item: WorkItem }>) {
  const release = item.deployedRelease ?? item.plannedReleases[0];
  if (!release) return null;
  const plannedLabel = release.status === 'DRAFT' ? 'В черновике' : 'Запланирована';
  const text = item.deployedRelease ? 'Внедрена' : plannedLabel;
  const more = item.deployedRelease
    ? 0
    : item.plannedReleases.filter((entry) => entry.status !== 'DRAFT').length - 1;
  return (
    <div className={'release-badge' + (item.deployedRelease ? ' deployed' : '')}>
      <CalendarClock size={13} /> {text} · {release.key}
      {item.deployedRelease && <small>{dateLabel(release.deployedAt)}</small>}
      {!item.deployedRelease && release.startsAt && (
        <small>{windowLabel(release.startsAt, release.endsAt)}</small>
      )}
      {more > 0 && <small>+{more}</small>}
    </div>
  );
}

function reviewLabel(item: WorkItem): string | null {
  if (item.status === 'IN_TEST') {
    return item.reviewer ? 'Проверяет · ' + item.reviewer.displayName : 'Ждёт тестировщика';
  }
  if (item.status === 'READY' && item.reviewer) return 'Проверка · ' + item.reviewer.displayName;
  return null;
}

const releaseActivityLabels: Record<ReleaseWorkEventKind, string> = {
  RELEASE_SUBMITTED: 'Релиз отправлен на согласование',
  RELEASE_ADDED: 'Добавлена в релиз',
  RELEASE_REMOVED: 'Исключена из релиза',
  RELEASE_DEPLOYED: 'Внедрена',
};

function activityLabel(entry: WorkEvent): string {
  if (entry.kind === 'CREATED') return 'Задача создана';
  if (entry.kind === 'REVIEW_CLAIMED') return 'Взята на проверку';
  if (entry.kind === 'ASSIGNMENT') return 'Сменился разработчик';
  if (entry.releaseKey !== null)
    return releaseActivityLabels[entry.kind] + ' · ' + entry.releaseKey;
  if (entry.kind === 'SPRINT_CHANGED') return 'Изменён спринт';
  if (entry.toStatus === 'READY') return 'Проверка подтверждена';
  if (entry.toStatus === 'IN_TEST') return 'Передана на проверку';
  if (entry.fromStatus === 'IN_TEST' || entry.fromStatus === 'READY') return 'Возвращена в работу';
  if (entry.toStatus === 'IN_PROGRESS') return 'Взята в работу';
  return 'Возвращена в очередь';
}

function activityDetail(entry: WorkEvent): string | null {
  if (entry.kind === 'SPRINT_CHANGED') {
    return (entry.fromSprint?.name ?? 'Бэклог') + ' → ' + (entry.toSprint?.name ?? 'Бэклог');
  }
  if (entry.kind === 'STATUS') {
    return workLabels[entry.fromStatus] + ' → ' + workLabels[entry.toStatus];
  }
  if (entry.kind === 'ASSIGNMENT') {
    return [
      entry.previousAssignee ?? 'Без назначения',
      entry.nextAssignee ?? 'Без назначения',
    ].join(' → ');
  }
  if (entry.kind === 'CREATED' && entry.nextAssignee) {
    return 'Разработчик · ' + entry.nextAssignee;
  }
  return null;
}

function WorkHistory({ history }: Readonly<{ history: WorkEvent[] }>) {
  return (
    <section className="task-history" aria-labelledby="task-history-heading">
      <h3 id="task-history-heading">
        <History size={17} aria-hidden="true" /> История задачи
      </h3>
      <ol className="task-timeline">
        {history.map((entry) => (
          <li key={entry.id}>
            <div className="task-timeline-heading">
              <strong>{activityLabel(entry)}</strong>
              <time dateTime={entry.occurredAt}>{dateLabel(entry.occurredAt)} МСК</time>
            </div>
            <div className="task-timeline-meta">
              <span>{entry.actor ?? 'Автор не записан'}</span>
              <span>{activityDetail(entry)}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function releaseTiming(release: ReleaseLink): string {
  if (release.deployedAt) return 'Внедрена · ' + dateLabel(release.deployedAt);
  const label = release.status === 'DRAFT' ? 'Черновик' : 'Плановое окно';
  return label + ' · ' + windowLabel(release.startsAt, release.endsAt);
}

export function WorkDetails({ item, onClose }: Readonly<{ item: WorkItem; onClose: () => void }>) {
  const review = reviewLabel(item);
  const history = item.history ?? [];
  const missingReviewHistory =
    (item.status === 'IN_TEST' || item.status === 'READY') &&
    !history.some(
      (entry) =>
        entry.releaseKey === null &&
        entry.kind === 'STATUS' &&
        (entry.toStatus === 'IN_TEST' || entry.toStatus === 'READY'),
    );
  return (
    <Modal title={item.key} onClose={onClose}>
      <h3>{item.title}</h3>
      <p className="muted">
        {typeLabels[item.type]} · {workLabels[item.status]}
      </p>
      <p className="muted">Приоритет · {priorityLabels[item.priority]}</p>
      {item.epic && (
        <p>
          Эпик · <a href={'#planning/' + item.epic.id}>{item.epic.title}</a>
        </p>
      )}
      <p>{item.sprint ? 'Спринт · ' + item.sprint.name : 'Бэклог'}</p>
      <p className="muted">Разработчик · {item.assignee?.displayName ?? 'Не назначен'}</p>
      {review && <p className="muted">{review}</p>}
      {item.description && <p className="preserve">{item.description}</p>}
      {item.requiredItem && (
        <p>
          Требуется {item.requiredItem.key} · {item.requiredItem.title}
        </p>
      )}
      <h3>Релизы</h3>
      {[...(item.deployedRelease ? [item.deployedRelease] : []), ...item.plannedReleases].map(
        (release) => (
          <div className="detail-row" key={release.key}>
            {release.id ? (
              <a href={'#release/' + release.id}>{release.key}</a>
            ) : (
              <strong>{release.key}</strong>
            )}
            <span>{releaseTiming(release)}</span>
          </div>
        ),
      )}
      {!item.deployedRelease && !item.plannedReleases.length && (
        <p className="muted">Задача ещё не включена в релиз.</p>
      )}
      {history.length ? <WorkHistory history={history} /> : null}
      {missingReviewHistory && (
        <p className="muted">Для этой задачи этапы проверки ранее не записывались.</p>
      )}
    </Modal>
  );
}

export function WorkEditor({
  item,
  people,
  systems,
  items,
  epics,
  initialEpic,
  onClose,
  onSave,
}: Readonly<{
  item?: WorkItem;
  people: Person[];
  systems: System[];
  items: WorkItem[];
  epics: Epic[];
  initialEpic?: Epic;
  onClose: () => void;
  onSave: (data: WorkFormData) => Promise<void>;
}>) {
  const [data, setData] = useState<WorkFormData>({
    type: item?.type ?? 'TASK',
    priority: item?.priority ?? 'NORMAL',
    epicId: item?.epic?.id ?? initialEpic?.id ?? null,
    systemId: item?.systemId ?? initialEpic?.systemId ?? systems[0]?.id ?? '',
    title: item?.title ?? '',
    description: item?.description ?? '',
    assigneeId: item?.assignee?.id ?? null,
    requiredItemId: item?.requiredItem?.id ?? null,
  });
  const [errorMessage, setErrorMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const editable = !item || item.status === 'TO_DO' || item.status === 'IN_PROGRESS';
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setBusy(true);
    setErrorMessage('');
    try {
      await onSave(data);
    } catch (error) {
      setErrorMessage(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={item ? 'Редактировать ' + item.key : 'Новая задача'} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <label>
          <span>Система</span>
          <select
            required
            value={data.systemId}
            disabled={!!item}
            onChange={(e) =>
              setData({ ...data, systemId: e.target.value, requiredItemId: null, epicId: null })
            }
          >
            {systems.map((system) => (
              <option key={system.id} value={system.id}>
                {system.name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            <span>Тип</span>
            <select
              disabled={!editable}
              value={data.type}
              onChange={(e) => setData({ ...data, type: e.target.value as WorkFormData['type'] })}
            >
              {Object.entries(typeLabels).map(([id, label]) => (
                <option value={id} key={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Приоритет</span>
            <select
              disabled={!editable}
              value={data.priority}
              onChange={(e) =>
                setData({ ...data, priority: e.target.value as WorkFormData['priority'] })
              }
            >
              {Object.entries(priorityLabels).map(([id, label]) => (
                <option value={id} key={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          <span>Эпик</span>
          <select
            disabled={!editable}
            value={data.epicId ?? ''}
            onChange={(e) => setData({ ...data, epicId: e.target.value || null })}
          >
            <option value="">Без эпика</option>
            {epics
              .filter((epic) => epic.systemId === data.systemId)
              .map((epic) => (
                <option value={epic.id} key={epic.id}>
                  {epic.title}
                </option>
              ))}
          </select>
        </label>
        <label>
          <span>Название</span>
          <input
            required
            value={data.title}
            disabled={!editable}
            onChange={(e) => setData({ ...data, title: e.target.value })}
            maxLength={160}
          />
        </label>
        <label>
          <span>Разработчик</span>
          <select
            value={data.assigneeId ?? ''}
            onChange={(e) => setData({ ...data, assigneeId: e.target.value || null })}
          >
            {(!item || item.status === 'TO_DO') && <option value="">Не назначен</option>}
            {people
              .filter((person) => person.role === 'ENGINEER')
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
          </select>
        </label>
        <label>
          <span>Описание</span>
          <textarea
            value={data.description ?? ''}
            disabled={!editable}
            onChange={(e) => setData({ ...data, description: e.target.value })}
          />
        </label>
        <label>
          <span>Обязательная задача</span>
          <select
            disabled={!editable}
            value={data.requiredItemId ?? ''}
            onChange={(e) => setData({ ...data, requiredItemId: e.target.value || null })}
          >
            <option value="">Без зависимости</option>
            {items
              .filter((entry) => entry.systemId === data.systemId && entry.id !== item?.id)
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.key} · {entry.title}
                </option>
              ))}
          </select>
        </label>
        {errorMessage && <Alert>{errorMessage}</Alert>}
        <div className="actions">
          <button type="submit" className="primary" disabled={busy}>
            {item ? 'Сохранить' : 'Создать задачу'}
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Отмена
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Board({
  person,
  people,
  systems,
}: Readonly<{
  person: Person;
  people: Person[];
  systems: System[];
}>) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [epics, setEpics] = useState<Epic[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [sprintId, setSprintId] = useState('');
  const activeSprint = sprints.find((sprint) => sprint.id === sprintId);
  const [systemId, setSystemId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [dragged, setDragged] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [editor, setEditor] = useState<WorkItem | 'new' | null>(null);
  const [detail, setDetail] = useState<WorkItem | null>(null);
  const [impact, setImpact] = useState<{
    item: WorkItem;
    target: WorkStatus;
    releases: ReleaseLink[];
  } | null>(null);

  useEffect(() => {
    let current = true;
    Promise.all([
      api<{ items: WorkItem[] }>('/work-items'),
      api<{ items: Epic[] }>('/epics'),
      api<{ items: Sprint[] }>('/sprints'),
    ])
      .then(([work, epicList, sprintList]) => {
        if (!current) return;
        setItems(work.items);
        setEpics(epicList.items);
        setSprints(sprintList.items);
        setSprintId(sprintList.items.find((sprint) => sprint.state === 'ACTIVE')?.id ?? '');
      })
      .catch((error: unknown) => {
        if (current) setErrorMessage(message(error));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);

  function update(item: WorkItem) {
    setItems((previous) =>
      previous.some((entry) => entry.id === item.id)
        ? previous.map((entry) => (entry.id === item.id ? item : entry))
        : [item, ...previous],
    );
  }

  const [claiming, setClaiming] = useState<string | null>(null);

  async function claimReview(item: WorkItem) {
    setClaiming(item.id);
    setErrorMessage('');
    const path = '/work-items/' + item.id;
    try {
      update(
        await api<WorkItem>(path + '/review/claim', 'POST', { expectedRevision: item.revision }),
      );
    } catch (error) {
      setErrorMessage(message(error));
      const current = await api<WorkItem>(path).catch(() => null);
      if (current) update(current);
    } finally {
      setClaiming(null);
    }
  }

  async function persistMove(item: WorkItem, target: WorkStatus) {
    try {
      update(
        await api<WorkItem>('/work-items/' + item.id + '/transitions', 'POST', {
          expectedRevision: item.revision,
          targetStatus: target,
        }),
      );
      setImpact(null);
    } catch (error) {
      setErrorMessage(message(error));
      setImpact(null);
    }
  }

  async function move(item: WorkItem, target: WorkStatus) {
    setDragged(null);
    setMenu(null);
    setErrorMessage('');
    if (item.status === target) return;
    if (!item.allowedTransitions.includes(target)) {
      setErrorMessage(
        item.status === 'IN_PROGRESS' && target === 'READY'
          ? 'Сначала передайте задачу на проверку.'
          : 'Этот переход недоступен.',
      );
      return;
    }
    if (item.status === 'READY') {
      try {
        const result = await api<{ revision: number; releases: ReleaseLink[] }>(
          '/work-items/' + item.id + '/return-impact',
        );
        setImpact({
          item: { ...item, revision: result.revision },
          target,
          releases: result.releases,
        });
      } catch (error) {
        setErrorMessage(message(error));
      }
      return;
    }
    await persistMove(item, target);
  }

  const shown = items.filter(
    (item) =>
      (!systemId || item.systemId === systemId) &&
      (!sprintId || item.sprint?.id === sprintId) &&
      (!assigneeId || item.assignee?.id === assigneeId) &&
      (!mineOnly || item.assignee?.id === person.id || item.reviewer?.id === person.id),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Доска задач</h1>
          <p>Работа команды от первой задачи до внедрения.</p>
        </div>
        {person.role === 'ENGINEER' && (
          <button type="button" className="primary" onClick={() => setEditor('new')}>
            <Plus size={18} /> Новая задача
          </button>
        )}
      </div>
      {activeSprint && (
        <div className="planning-focus">
          <strong>{activeSprint.name}</strong>
          <p>{activeSprint.goal}</p>
          <small>{sprintPeriod(activeSprint.startsOn, activeSprint.endsOn)}</small>
        </div>
      )}
      <div className="filter-bar">
        {sprints.some((sprint) => sprint.state === 'ACTIVE') && (
          <select
            aria-label="Спринт на доске"
            value={sprintId}
            onChange={(e) => setSprintId(e.target.value)}
          >
            <option value="">Все задачи</option>
            {sprints
              .filter((sprint) => sprint.state === 'ACTIVE')
              .map((sprint) => (
                <option key={sprint.id} value={sprint.id}>
                  {sprint.name}
                </option>
              ))}
          </select>
        )}
        <Filter size={17} />
        <button
          type="button"
          className="secondary mine-filter"
          aria-pressed={mineOnly}
          onClick={() => setMineOnly(!mineOnly)}
        >
          <UserRound size={16} aria-hidden="true" /> Мои задачи
        </button>
        <select
          aria-label="Фильтр по системе"
          value={systemId}
          onChange={(e) => setSystemId(e.target.value)}
        >
          <option value="">Все системы</option>
          {systems.map((system) => (
            <option key={system.id} value={system.id}>
              {system.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Фильтр по разработчику"
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
        >
          <option value="">Все разработчики</option>
          {people
            .filter((entry) => entry.role === 'ENGINEER')
            .map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.displayName}
              </option>
            ))}
        </select>
        <output className="muted">{loading ? 'Загрузка…' : 'Задач: ' + shown.length}</output>
      </div>
      {errorMessage && <Alert>{errorMessage}</Alert>}
      {mineOnly && !loading && !errorMessage && shown.length === 0 && (
        <output className="muted board-empty">По выбранным фильтрам ваших задач нет.</output>
      )}
      <div className="board">
        {columns.map(({ status, icon: Icon }) => {
          const cards = shown.filter((item) => item.status === status);
          return (
            <section
              className={'column ' + status.toLowerCase()}
              key={status}
              aria-label={workLabels[status]}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const item = items.find(
                  (entry) => entry.id === (e.dataTransfer.getData('text/plain') || dragged),
                );
                if (item) void move(item, status);
              }}
            >
              <h2>
                <Icon size={18} /> {workLabels[status]} <span>{cards.length}</span>
              </h2>
              {cards.map((item) => (
                <article
                  className="task"
                  key={item.id}
                  draggable={!!item.allowedTransitions.length}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', item.id);
                    setDragged(item.id);
                  }}
                  onDragEnd={() => setDragged(null)}
                >
                  <div className="task-top">
                    <span className="task-identity">
                      <span className="mono">{item.key}</span>{' '}
                      <span className={'planning-type ' + item.type.toLowerCase()}>
                        {typeLabels[item.type]}
                      </span>
                    </span>
                    {!!item.allowedTransitions.length && (
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={'Переместить ' + item.key}
                        aria-expanded={menu === item.id}
                        onClick={() => setMenu(menu === item.id ? null : item.id)}
                      >
                        <ArrowRightLeft size={15} />
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    className="task-title"
                    onClick={() => {
                      void api<WorkItem>('/work-items/' + item.id)
                        .then(setDetail)
                        .catch((error: unknown) => setErrorMessage(message(error)));
                    }}
                  >
                    {item.title} <ChevronRight size={14} />
                  </button>
                  <div className="task-person">
                    <UserRound size={14} /> Разработчик ·{' '}
                    {item.assignee?.displayName ?? 'Не назначен'}
                  </div>
                  {reviewLabel(item) && (
                    <div className="task-person">
                      <ClipboardCheck size={14} />
                      {reviewLabel(item)}
                    </div>
                  )}
                  {item.status === 'TO_DO' && item.allowedTransitions.includes('IN_PROGRESS') && (
                    <button
                      type="button"
                      className="secondary task-action"
                      onClick={() => void move(item, 'IN_PROGRESS')}
                    >
                      {item.assignee ? 'Начать работу' : 'Взять в работу'}
                    </button>
                  )}
                  {item.status === 'TO_DO' &&
                    person.role === 'ENGINEER' &&
                    item.assignee &&
                    item.assignee.id !== person.id && (
                      <small className="muted">Работу начнёт назначенный разработчик.</small>
                    )}
                  {item.canClaimReview && (
                    <button
                      type="button"
                      className="secondary task-action"
                      disabled={claiming !== null}
                      onClick={() => void claimReview(item)}
                    >
                      Взять на проверку
                    </button>
                  )}
                  {item.status === 'IN_PROGRESS' && item.allowedTransitions.includes('IN_TEST') && (
                    <button
                      type="button"
                      className="secondary task-action"
                      onClick={() => void move(item, 'IN_TEST')}
                    >
                      Передать на проверку
                    </button>
                  )}
                  {item.status === 'IN_TEST' && item.allowedTransitions.includes('READY') && (
                    <div className="actions task-action">
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void move(item, 'READY')}
                      >
                        Подтвердить проверку
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void move(item, 'IN_PROGRESS')}
                      >
                        Вернуть в работу
                      </button>
                    </div>
                  )}
                  <ReleaseBadge item={item} />
                  {menu === item.id && (
                    <div className="move-menu">
                      {item.allowedTransitions.map((target) => (
                        <button type="button" key={target} onClick={() => void move(item, target)}>
                          {workLabels[target]}
                        </button>
                      ))}
                    </div>
                  )}
                  {person.role === 'ENGINEER' && !item.deployedRelease && (
                    <button
                      type="button"
                      className="quiet task-edit"
                      onClick={() => setEditor(item)}
                    >
                      Редактировать
                    </button>
                  )}
                </article>
              ))}
              {!cards.length && <p className="column-empty">Нет задач</p>}
            </section>
          );
        })}
      </div>
      {editor && (
        <WorkEditor
          item={editor === 'new' ? undefined : editor}
          people={people}
          systems={systems}
          items={items}
          epics={epics}
          onClose={() => setEditor(null)}
          onSave={async (data) => {
            if (editor === 'new') update(await api<WorkItem>('/work-items', 'POST', data));
            else {
              const {
                assigneeId: assignee,
                title,
                description,
                requiredItemId,
                type,
                priority,
                epicId,
              } = data;
              const fields =
                editor.status === 'TO_DO' || editor.status === 'IN_PROGRESS'
                  ? { title, description, requiredItemId, type, priority, epicId }
                  : {};
              update(
                await api<WorkItem>('/work-items/' + editor.id, 'PATCH', {
                  expectedRevision: editor.revision,
                  assigneeId: assignee,
                  ...fields,
                }),
              );
            }
            setEditor(null);
          }}
        />
      )}
      {detail && <WorkDetails item={detail} onClose={() => setDetail(null)} />}
      {impact && (
        <Modal title={'Вернуть ' + impact.item.key + ' в работу'} onClose={() => setImpact(null)}>
          {impact.releases.length ? (
            <>
              <p>Задача помешает согласованию или внедрению этих релизов:</p>
              {impact.releases.map((release) => (
                <div className="detail-row" key={release.key}>
                  <strong>{release.key}</strong>
                  <span>{windowLabel(release.startsAt, release.endsAt)}</span>
                </div>
              ))}
            </>
          ) : (
            <p>Задача пока не запланирована в отправленном релизе.</p>
          )}
          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={() => void persistMove(impact.item, impact.target)}
            >
              Вернуть в работу
            </button>
            <button type="button" className="secondary" onClick={() => setImpact(null)}>
              Отмена
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
