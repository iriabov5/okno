import { useEffect, useState, type SubmitEvent } from 'react';
import { CalendarDays, Layers, Plus } from 'lucide-react';
import { api, message, RequestError } from './api';
import { WorkDetails, WorkEditor } from './Board';
import {
  dateLabel,
  priorityLabels,
  sprintLabels,
  sprintPeriod,
  typeLabels,
  workLabels,
} from './labels';
import type { Epic, Person, Sprint, System, WorkItem } from './types';
import { Alert, Modal } from './ui';

type PlanningData = { work: WorkItem[]; epics: Epic[]; sprints: Sprint[] };
type PreviewItem = Pick<WorkItem, 'id' | 'key' | 'title' | 'status'>;
type Warning = {
  itemKey: string;
  releaseKey: string;
  releaseId: string | null;
  releaseStartsAt: string | null;
  dependentKeys: string[];
  reasons: ('MOVED_AFTER_RELEASE' | 'MOVED_TO_BACKLOG' | 'DEPENDENCY_MOVED')[];
};
type Preview = {
  readyItems: PreviewItem[];
  movingItems: PreviewItem[];
  warnings: Warning[];
  previewToken: string;
};
type Result = Omit<PreviewItem, 'status'> & {
  statusAtClose: WorkItem['status'];
  destinationSprintId: string | null;
};

async function readPlanning(): Promise<PlanningData> {
  const [work, epics, sprints] = await Promise.all([
    api<{ items: WorkItem[] }>('/work-items'),
    api<{ items: Epic[] }>('/epics'),
    api<{ items: Sprint[] }>('/sprints'),
  ]);
  return { work: work.items, epics: epics.items, sprints: sprints.items };
}

function PlanningForm({
  kind,
  systems,
  onClose,
  onSaved,
}: Readonly<{
  kind: 'epic' | 'sprint';
  systems: System[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}>) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const epic = kind === 'epic';
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(
        epic ? '/epics' : '/sprints',
        'POST',
        Object.fromEntries(new FormData(event.currentTarget)),
      );
      await onSaved();
    } catch (error_) {
      setError(message(error_));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={epic ? 'Новый эпик' : 'Новый спринт'} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        {epic && (
          <label>
            <span>Система</span>
            <select name="systemId" required>
              {systems.map((system) => (
                <option value={system.id} key={system.id}>
                  {system.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span>Название</span>
          <input name={epic ? 'title' : 'name'} required maxLength={epic ? 160 : 120} />
        </label>
        <label>
          <span>Цель</span>
          <textarea name="goal" required maxLength={500} />
        </label>
        {!epic && (
          <div className="form-grid">
            <label>
              <span>Начало</span>
              <input name="startsOn" type="date" required />
            </label>
            <label>
              <span>Окончание</span>
              <input name="endsOn" type="date" required />
            </label>
          </div>
        )}
        {error && <Alert>{error}</Alert>}
        <div className="actions">
          <button type="submit" className="primary" disabled={busy}>
            Создать
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MoveCard({
  item,
  sprints,
  onClose,
  onSaved,
}: Readonly<{
  item: WorkItem;
  sprints: Sprint[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}>) {
  const [destination, setDestination] = useState(
    item.sprint?.state === 'CLOSED' ? '' : (item.sprint?.id ?? ''),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function move(event: SubmitEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api('/work-items/' + item.id + '/sprint', 'POST', {
        expectedRevision: item.revision,
        sprintId: destination || null,
      });
      await onSaved();
    } catch (error_) {
      setError(message(error_));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={'Перенести ' + item.key} onClose={onClose}>
      <form className="form-stack" onSubmit={move}>
        <p>{item.title}</p>
        <label>
          <span>Куда перенести</span>
          <select value={destination} onChange={(e) => setDestination(e.target.value)}>
            <option value="">Бэклог</option>
            {sprints
              .filter((sprint) => sprint.state !== 'CLOSED')
              .map((sprint) => (
                <option key={sprint.id} value={sprint.id}>
                  {sprint.name}
                </option>
              ))}
          </select>
        </label>
        {error && <Alert>{error}</Alert>}
        <div className="actions">
          <button type="submit" className="primary" disabled={busy}>
            Перенести
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Completion({
  sprint,
  sprints,
  onClose,
  onSaved,
}: Readonly<{
  sprint: Sprint;
  sprints: Sprint[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}>) {
  const [destinationId, setDestinationId] = useState('');
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const destination = sprints.find((entry) => entry.id === destinationId);
  const path = '/sprints/' + sprint.id;
  const input = { expectedRevision: sprint.revision, destinationSprintId: destinationId || null };
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (preview) {
        await api(path + '/complete', 'POST', { ...input, previewToken: preview.previewToken });
        await onSaved();
      } else {
        setPreview(await api<Preview>(path + '/completion-preview', 'POST', input));
      }
    } catch (error_) {
      setError(message(error_));
      if (error_ instanceof RequestError && error_.status === 409) {
        setPreview(undefined);
        if (error_.code === 'STALE_REVISION' || error_.code === 'INVALID_STATE') {
          setError('Спринт изменился. Закройте окно и откройте завершение заново.');
        }
      }
    } finally {
      setBusy(false);
    }
  }
  const releaseKeys = [...new Set(preview?.warnings.map((warning) => warning.releaseKey))];
  return (
    <Modal title={'Завершить спринт «' + sprint.name + '»'} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <p>{sprint.goal}</p>
        <label>
          <span>Куда перенести незавершённые карточки</span>
          <select
            disabled={busy}
            value={destinationId}
            onChange={(e) => {
              setDestinationId(e.target.value);
              setPreview(undefined);
            }}
          >
            <option value="">Бэклог</option>
            {sprints
              .filter((entry) => entry.state === 'PLANNED')
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
          </select>
        </label>
        {preview && (
          <div className="planning-preview">
            <strong>Готово · {preview.readyItems.length}</strong>
            {preview.readyItems.map((item) => (
              <p key={item.id}>
                {item.key} · {item.title}
              </p>
            ))}
            <strong>К переносу · {preview.movingItems.length}</strong>
            {preview.movingItems.map((item) => (
              <p key={item.id}>
                {item.key} · {item.title} · {workLabels[item.status]}
              </p>
            ))}
            {releaseKeys.map((key) => (
              <section className="planning-warning" key={key}>
                {preview.warnings
                  .filter((warning) => warning.releaseKey === key)
                  .map((warning) => (
                    <div key={warning.itemKey}>
                      <strong>
                        {warning.releaseId ? (
                          <a href={'#release/' + warning.releaseId}>{key}</a>
                        ) : (
                          key
                        )}{' '}
                        · {warning.itemKey}
                      </strong>
                      {warning.releaseStartsAt && (
                        <p>Выкладка · {dateLabel(warning.releaseStartsAt)} МСК</p>
                      )}
                      {warning.reasons.includes('MOVED_AFTER_RELEASE') && destination && (
                        <p>
                          Следующий спринт начинается{' '}
                          {sprintPeriod(destination.startsOn, destination.startsOn)}.
                        </p>
                      )}
                      {warning.reasons.includes('MOVED_TO_BACKLOG') && (
                        <p>У карточки в бэклоге не будет даты спринта.</p>
                      )}
                      {warning.reasons.includes('DEPENDENCY_MOVED') && (
                        <p>
                          От карточки зависят задачи в составе релиза{' '}
                          {warning.dependentKeys.join(', ')}.
                        </p>
                      )}
                    </div>
                  ))}
              </section>
            ))}
          </div>
        )}
        {error && <Alert>{error}</Alert>}
        <div className="actions">
          <button type="submit" className="primary" disabled={busy}>
            {preview ? 'Подтвердить завершение' : 'Проверить перенос'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const priorityOrder = { HIGH: 0, NORMAL: 1, LOW: 2 };

export function Planning({
  person,
  people,
  systems,
  epicId,
}: Readonly<{
  person: Person;
  people: Person[];
  systems: System[];
  epicId: string;
}>) {
  const [data, setData] = useState<PlanningData>();
  const [error, setError] = useState('');
  const [form, setForm] = useState<'epic' | 'sprint' | 'task'>();
  const [detail, setDetail] = useState<WorkItem>();
  const [moving, setMoving] = useState<WorkItem>();
  const [completing, setCompleting] = useState<Sprint>();
  const [results, setResults] = useState<{ sprint: Sprint; items: Result[] }>();
  const [system, setSystem] = useState('');
  const [type, setType] = useState('');
  const [busy, setBusy] = useState(false);
  const planner = person.role === 'ENGINEER' || person.role === 'ADMIN';
  useEffect(() => {
    let active = true;
    readPlanning()
      .then((result) => {
        if (active) setData(result);
      })
      .catch((error_: unknown) => {
        if (active) setError(message(error_));
      });
    return () => {
      active = false;
    };
  }, []);

  async function refresh() {
    const updated = await readPlanning();
    setData(updated);
    setForm(undefined);
    setMoving(undefined);
    setCompleting(undefined);
    return updated;
  }
  async function perform(action: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (error_) {
      setError(message(error_));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <Alert>{error}</Alert> : <p>Загрузка…</p>;
  const { work, epics, sprints } = data;
  const hasActiveSprint = sprints.some((sprint) => sprint.state === 'ACTIVE');
  const selectedEpic = epics.find((epic) => epic.id === epicId);
  const matches = (item: WorkItem) =>
    (!system || system === item.systemId) &&
    (!type || type === item.type) &&
    (!epicId || item.epic?.id === epicId);
  const backlog = work
    .filter((item) => !item.sprint && !item.deployedRelease && matches(item))
    .sort(
      (first, second) =>
        priorityOrder[first.priority] - priorityOrder[second.priority] ||
        first.key.localeCompare(second.key, 'ru', { numeric: true }),
    );
  function workList(items: WorkItem[]) {
    return items.length ? (
      <ul className="planning-work">
        {items.map((item) => {
          const closed = item.sprint?.state === 'CLOSED';
          const canMove = planner && !item.deployedRelease && (!closed || item.status !== 'READY');
          return (
            <li key={item.id}>
              <div>
                <p className="planning-meta">
                  <span className={'planning-type ' + item.type.toLowerCase()}>
                    {typeLabels[item.type]}
                  </span>{' '}
                  <span className="mono">{item.key}</span> · {workLabels[item.status]}
                </p>
                <button
                  className="planning-link"
                  type="button"
                  onClick={() =>
                    void perform(async () =>
                      setDetail(await api<WorkItem>('/work-items/' + item.id)),
                    )
                  }
                >
                  {item.title}
                </button>
                <small className="planning-item-context">
                  {item.assignee?.displayName ?? 'Без исполнителя'} ·{' '}
                  {priorityLabels[item.priority]} приоритет
                  {item.epic ? ' · ' + item.epic.title : ''}
                </small>
              </div>
              {canMove && (
                <button
                  type="button"
                  className="secondary"
                  aria-label={(closed ? 'Запланировать снова ' : 'Перенести ') + item.key}
                  onClick={() => setMoving(item)}
                >
                  {closed ? 'Запланировать снова' : 'Перенести'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    ) : (
      <p className="muted">Нет карточек.</p>
    );
  }

  async function openResults(sprint: Sprint) {
    const result = await api<{ items: Result[] }>('/sprints/' + sprint.id + '/results');
    setResults({ sprint, items: result.items });
  }

  return (
    <>
      <div className="page-heading">
        <h1>Планирование</h1>
        {planner && (
          <div className="actions">
            <button className="secondary" type="button" onClick={() => setForm('epic')}>
              <Layers size={16} /> Новый эпик
            </button>
            <button className="primary" type="button" onClick={() => setForm('sprint')}>
              <Plus size={16} /> Новый спринт
            </button>
          </div>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="filter-bar planning-filters">
        <select
          aria-label="Система в планировании"
          value={system}
          onChange={(e) => {
            setSystem(e.target.value);
            if (selectedEpic && e.target.value && selectedEpic.systemId !== e.target.value)
              location.hash = 'planning';
          }}
        >
          <option value="">Все системы</option>
          {systems.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        <select aria-label="Тип карточки" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Все типы</option>
          {Object.entries(typeLabels).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Фильтр по эпику"
          value={epicId}
          onChange={(e) => {
            location.hash = e.target.value ? 'planning/' + e.target.value : 'planning';
          }}
        >
          <option value="">Все эпики</option>
          {epics
            .filter((epic) => !system || epic.systemId === system)
            .map((epic) => (
              <option key={epic.id} value={epic.id}>
                {epic.title}
              </option>
            ))}
        </select>
      </div>
      {selectedEpic && (
        <section className="planning-focus">
          <small>
            Эпик · {selectedEpic.readyCount} из {selectedEpic.itemCount} готово
          </small>
          <h2>{selectedEpic.title}</h2>
          <p>{selectedEpic.goal}</p>
        </section>
      )}
      <div className="planning-layout">
        <div className="planning-stack">
          <section className="panel planning-panel" aria-label="Бэклог">
            <div className="planning-heading">
              <h2>
                Бэклог <span className="count">{backlog.length}</span>
              </h2>
              {person.role === 'ENGINEER' && (
                <button type="button" className="secondary" onClick={() => setForm('task')}>
                  Новая задача
                </button>
              )}
            </div>
            {workList(backlog)}
          </section>
          {selectedEpic && (
            <section className="panel planning-panel" aria-label="Карточки эпика">
              <h2>Карточки эпика</h2>
              {workList(
                work.filter(
                  (item) =>
                    matches(item) &&
                    (item.sprint?.state === 'CLOSED' ||
                      (!item.sprint && Boolean(item.deployedRelease))),
                ),
              )}
            </section>
          )}
          {!selectedEpic && epics.length > 0 && (
            <section className="panel planning-panel">
              <h2>Эпики</h2>
              {epics
                .filter((epic) => !system || epic.systemId === system)
                .map((epic) => (
                  <a className="planning-epic" href={'#planning/' + epic.id} key={epic.id}>
                    <strong>{epic.title}</strong>
                    <small>
                      {epic.readyCount} из {epic.itemCount} готово
                    </small>
                  </a>
                ))}
            </section>
          )}
        </div>
        <div className="planning-stack">
          {!sprints.some((sprint) => sprint.state !== 'CLOSED') && (
            <section className="panel planning-panel">
              <h2>Спринты</h2>
              <p className="muted">Спринтов пока нет.</p>
            </section>
          )}
          {sprints
            .filter((sprint) => sprint.state !== 'CLOSED')
            .map((sprint) => (
              <section
                className={
                  'panel planning-panel ' + (sprint.state === 'ACTIVE' ? 'active-sprint' : '')
                }
                key={sprint.id}
                aria-label={sprint.name}
              >
                <div className="planning-heading">
                  <h2>{sprint.name}</h2>
                  <span className="planning-type">{sprintLabels[sprint.state]}</span>
                </div>
                <p className="planning-meta">
                  <CalendarDays size={15} /> {sprintPeriod(sprint.startsOn, sprint.endsOn)} ·{' '}
                  {sprint.readyCount} из {sprint.itemCount} готово
                </p>
                <p>{sprint.goal}</p>
                {workList(work.filter((item) => item.sprint?.id === sprint.id && matches(item)))}
                <div className="actions">
                  {sprint.state === 'ACTIVE' && (
                    <a className="secondary" href="#board">
                      Открыть доску
                    </a>
                  )}
                  {planner && sprint.state === 'ACTIVE' && (
                    <button type="button" className="primary" onClick={() => setCompleting(sprint)}>
                      Завершить спринт
                    </button>
                  )}
                  {planner && sprint.state === 'PLANNED' && !hasActiveSprint && (
                    <button
                      type="button"
                      className="primary"
                      disabled={busy || !sprint.itemCount}
                      onClick={() =>
                        void perform(async () => {
                          await api('/sprints/' + sprint.id + '/start', 'POST', {
                            expectedRevision: sprint.revision,
                          });
                          await refresh();
                        })
                      }
                    >
                      Запустить спринт
                    </button>
                  )}
                </div>
              </section>
            ))}
          {sprints.some((sprint) => sprint.state === 'CLOSED') && (
            <section className="panel planning-panel">
              <h2>Завершённые спринты</h2>
              {sprints
                .filter((sprint) => sprint.state === 'CLOSED')
                .map((sprint) => (
                  <button
                    type="button"
                    className="planning-link planning-epic"
                    key={sprint.id}
                    onClick={() => void perform(() => openResults(sprint))}
                  >
                    <strong>{sprint.name}</strong>
                    <small>
                      {sprint.readyCount} готово · {sprint.itemCount - sprint.readyCount} перенесено
                    </small>
                  </button>
                ))}
            </section>
          )}
          {!selectedEpic &&
            work.some(
              (item) => item.sprint?.state === 'CLOSED' && item.status !== 'READY' && matches(item),
            ) && (
              <section className="panel planning-panel">
                <h2>Возвращены в работу</h2>
                {workList(
                  work.filter(
                    (item) =>
                      item.sprint?.state === 'CLOSED' && item.status !== 'READY' && matches(item),
                  ),
                )}
              </section>
            )}
        </div>
      </div>
      {(form === 'epic' || form === 'sprint') && (
        <PlanningForm
          kind={form}
          systems={systems}
          onClose={() => setForm(undefined)}
          onSaved={async () => {
            await refresh();
          }}
        />
      )}
      {form === 'task' && (
        <WorkEditor
          systems={systems}
          people={people}
          items={work}
          epics={epics}
          initialEpic={selectedEpic}
          onClose={() => setForm(undefined)}
          onSave={async (input) => {
            await api('/work-items', 'POST', input);
            await refresh();
          }}
        />
      )}
      {detail && <WorkDetails item={detail} onClose={() => setDetail(undefined)} />}
      {moving && (
        <MoveCard
          item={moving}
          sprints={sprints}
          onClose={() => setMoving(undefined)}
          onSaved={async () => {
            await refresh();
          }}
        />
      )}
      {completing && (
        <Completion
          sprint={completing}
          sprints={sprints}
          onClose={() => {
            setCompleting(undefined);
            void perform(async () => {
              setData(await readPlanning());
            });
          }}
          onSaved={async () => {
            const updated = await refresh();
            await openResults(
              updated.sprints.find((entry) => entry.id === completing.id) ?? completing,
            );
          }}
        />
      )}
      {results && (
        <Modal title={'Итоги · ' + results.sprint.name} onClose={() => setResults(undefined)}>
          <p>{results.sprint.goal}</p>
          <p className="muted">{sprintPeriod(results.sprint.startsOn, results.sprint.endsOn)}</p>
          <p>
            <strong>
              {results.sprint.readyCount} готово ·{' '}
              {results.sprint.itemCount - results.sprint.readyCount} перенесено
            </strong>
          </p>
          <ul className="planning-work">
            {results.items.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>
                    {item.key} · {item.title}
                  </strong>
                  <small className="planning-item-context">
                    {workLabels[item.statusAtClose]}
                    {item.statusAtClose !== 'READY' &&
                      ' → ' +
                        (sprints.find((entry) => entry.id === item.destinationSprintId)?.name ??
                          'Бэклог')}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}
