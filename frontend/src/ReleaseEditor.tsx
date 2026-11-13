import { useEffect, useState, type SubmitEvent } from 'react';
import { ArrowRight, CalendarClock, Check, GitBranch, Plus, Search, X } from 'lucide-react';
import { api, message, query } from './api';
import { moscowInput, moscowValue, stageLabels, windowLabel, workLabels } from './labels';
import type {
  Blocker,
  CalendarPreview,
  ChangePreview,
  ReleaseCard,
  ScopePreview,
  System,
  WorkItem,
} from './types';
import { Alert } from './ui';

export function ScopeAlerts({ blockers }: Readonly<{ blockers: Blocker[] }>) {
  if (!blockers.length) return null;
  return (
    <Alert>
      <strong>Что мешает релизу</strong>
      <ul>
        {blockers.map((blocker) => (
          <li key={(blocker.key ?? '') + blocker.code}>
            {blocker.key && <strong>{blocker.key} · </strong>}
            {blocker.message}
            {blocker.assignee && ' ' + blocker.assignee}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

export function CalendarCheck({
  result,
  apply,
}: Readonly<{
  result: CalendarPreview;
  apply?: (window: { startsAt: string; endsAt: string }) => void;
}>) {
  if (!result.conflicts.length)
    return (
      <div className="positive">
        <Check size={17} /> Окно свободно
      </div>
    );
  return (
    <Alert>
      <strong>Окно занято</strong>
      <ul>
        {result.conflicts.map((block, index) => (
          <li key={block.resource + index}>
            {block.resource} · {windowLabel(block.startsAt, block.endsAt)} · {block.description}
          </li>
        ))}
      </ul>
      {result.suggestedWindow ? (
        <div>
          <p>
            Ближайшее окно ·{' '}
            {windowLabel(result.suggestedWindow.startsAt, result.suggestedWindow.endsAt)}
          </p>
          {apply && (
            <button
              className="secondary"
              type="button"
              onClick={() => {
                if (result.suggestedWindow) apply(result.suggestedWindow);
              }}
            >
              Применить предложенное окно
            </button>
          )}
        </div>
      ) : (
        <p>В ближайшие 48 часов свободного окна нет.</p>
      )}
    </Alert>
  );
}

const effectLabels: Record<string, string> = {
  KEEP: 'Сохраняется',
  RECHECK: 'Повторная проверка',
  ADD: 'Новый этап',
  REMOVE: 'Этап снимается',
  PENDING: 'Ожидает решения',
};

export function ReleaseEditor({
  card,
  mode,
  systems,
  onSaved,
  onCancel,
}: Readonly<{
  card?: ReleaseCard;
  mode: 'draft' | 'change';
  systems: System[];
  onSaved: (card: ReleaseCard) => void;
  onCancel: () => void;
}>) {
  const [saved, setSaved] = useState(card);
  const [systemId, setSystemId] = useState(card?.system?.id ?? systems[0]?.id ?? '');
  const [title, setTitle] = useState(card?.title ?? '');
  const [plan, setPlan] = useState(card?.rollbackPlan ?? '');
  const [starts, setStarts] = useState(moscowInput(card?.startsAt));
  const [ends, setEnds] = useState(moscowInput(card?.endsAt));
  const [tag, setTag] = useState(card?.gitlabTagUrl ?? '');
  const [selected, setSelected] = useState<{ key: string; title: string }[]>(card?.items ?? []);
  const [search, setSearch] = useState('');
  const [picker, setPicker] = useState(false);
  const [catalog, setCatalog] = useState<WorkItem[]>([]);
  const [pending, setPending] = useState<WorkItem | null>(null);
  const [scope, setScope] = useState<ScopePreview>({ blockers: [], dependencies: [] });
  const [calendar, setCalendar] = useState<CalendarPreview | null>(null);
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const systemLocked = mode === 'change' || saved?.status === 'CHANGES_REQUESTED';

  useEffect(() => {
    if (!systemId || !picker) return;
    let current = true;
    api<{ items: WorkItem[] }>('/systems/' + systemId + '/release-items' + query({ q: search }))
      .then((result) => {
        if (current) setCatalog(result.items);
      })
      .catch((error: unknown) => {
        if (current) setErrorMessage(message(error));
      });
    return () => {
      current = false;
    };
  }, [systemId, picker, search]);

  useEffect(() => {
    if (!systemId) return;
    let current = true;
    api<ScopePreview>('/systems/' + systemId + '/release-scope/preview', 'POST', {
      itemKeys: selected.map((item) => item.key),
    })
      .then((result) => {
        if (current) setScope(result);
      })
      .catch((error: unknown) => {
        if (current) setErrorMessage(message(error));
      });
    return () => {
      current = false;
    };
  }, [systemId, selected]);

  function addItem(item: { key: string; title: string }) {
    setSelected((items) =>
      items.some((entry) => entry.key === item.key)
        ? items
        : [...items, { key: item.key, title: item.title }],
    );
    setPending(null);
    setPreview(null);
  }

  async function chooseDependency(key: string) {
    setErrorMessage('');
    try {
      const result = await api<{ items: WorkItem[] }>(
        '/systems/' + systemId + '/release-items' + query({ q: key }),
      );
      const item = result.items.find((entry) => entry.key === key);
      if (item && !item.deployedRelease) choose(item);
    } catch (error) {
      setErrorMessage(message(error));
    }
  }

  function choose(item: WorkItem) {
    if (item.status === 'READY') addItem(item);
    else setPending(item);
  }

  const proposed = {
    startsAt: moscowValue(starts),
    endsAt: moscowValue(ends),
    itemKeys: selected.map((item) => item.key),
    gitlabTagUrl: tag.trim() || null,
  };

  async function checkWindow() {
    setErrorMessage('');
    try {
      setCalendar(
        await api<CalendarPreview>('/windows/preview', 'POST', {
          systemId,
          startsAt: proposed.startsAt,
          endsAt: proposed.endsAt,
        }),
      );
    } catch (error) {
      setErrorMessage(message(error));
    }
  }

  async function applyWindow(window: { startsAt: string; endsAt: string }) {
    setStarts(moscowInput(window.startsAt));
    setEnds(moscowInput(window.endsAt));
    setPreview(null);
    setCalendar(null);
    setErrorMessage('');
    try {
      setCalendar(await api<CalendarPreview>('/windows/preview', 'POST', { systemId, ...window }));
    } catch (error) {
      setErrorMessage(message(error));
    }
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const button = event.nativeEvent.submitter;
    const intent = button instanceof HTMLButtonElement ? button.value : 'save';
    setErrorMessage('');
    setBusy(true);
    try {
      if (mode === 'change' && saved) {
        const body = { expectedRevision: saved.revision, proposedChanges: proposed };
        if (intent === 'confirm')
          onSaved(
            await api<ReleaseCard>('/release-requests/' + saved.id + '/changes', 'POST', body),
          );
        else
          setPreview(
            await api<ChangePreview>(
              '/release-requests/' + saved.id + '/changes/preview',
              'POST',
              body,
            ),
          );
        return;
      }
      const draft = { ...proposed, systemId: systemId || null, title, rollbackPlan: plan };
      let result = saved
        ? await api<ReleaseCard>('/release-requests/' + saved.id, 'PATCH', {
            ...draft,
            expectedRevision: saved.revision,
          })
        : await api<ReleaseCard>('/release-requests', 'POST', draft);
      setSaved(result);
      if (intent === 'submit') {
        result = await api<ReleaseCard>('/release-requests/' + result.id + '/submit', 'POST', {
          expectedRevision: result.revision,
        });
      }
      onSaved(result);
    } catch (error) {
      setErrorMessage(message(error));
    } finally {
      setBusy(false);
    }
  }

  const draftHeading = card ? 'Редактировать ' + card.key : 'Новая заявка';
  const heading = mode === 'change' ? 'Изменить ' + card?.key : draftHeading;

  return (
    <form className="release-form form-stack" onSubmit={(event) => void submit(event)}>
      <div className="page-heading">
        <div>
          <h1>{heading}</h1>
          <p>
            {mode === 'change'
              ? 'Посмотрите, какие этапы затронут изменения.'
              : 'Соберите состав и подберите окно внедрения.'}
          </p>
        </div>
        <button type="button" className="secondary" onClick={onCancel}>
          Назад
        </button>
      </div>
      <section className="panel form-stack">
        <h2>Релиз</h2>
        <div className="form-grid">
          <label>
            <span>Система</span>
            <select
              value={systemId}
              disabled={systemLocked}
              onChange={(e) => {
                setSystemId(e.target.value);
                setSelected([]);
                setCatalog([]);
                setPending(null);
                setPreview(null);
                setCalendar(null);
              }}
            >
              <option value="">Выберите систему</option>
              {systems.map((system) => (
                <option value={system.id} key={system.id}>
                  {system.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Название</span>
            <input
              value={title}
              disabled={mode === 'change'}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Обновление сервиса уведомлений"
              maxLength={160}
            />
          </label>
        </div>
        <label>
          <span>
            <GitBranch size={15} /> Тег GitLab <small>необязательно</small>
          </span>
          <input
            type="url"
            value={tag}
            onChange={(e) => {
              setTag(e.target.value);
              setPreview(null);
            }}
            placeholder="https://gitlab.example.ru/team/project/-/tags/v1.2.0"
          />
        </label>
      </section>
      <section className="panel form-stack">
        <div className="panel-heading">
          <h2>Состав релиза</h2>
          <button
            type="button"
            className="secondary"
            disabled={!systemId}
            onClick={() => setPicker(!picker)}
          >
            <Plus size={16} /> Подобрать задачи
          </button>
        </div>
        {selected.map((item) => (
          <div key={item.key} className="detail-row">
            <span>
              <strong className="mono">{item.key}</strong> · {item.title}
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label={'Удалить ' + item.key}
              onClick={() => {
                setSelected(selected.filter((entry) => entry.key !== item.key));
                setPreview(null);
              }}
            >
              <X size={16} />
            </button>
          </div>
        ))}
        {!selected.length && (
          <p className="muted">Добавьте задачи с доски по номеру или названию.</p>
        )}
        {picker && (
          <div className="picker">
            <label className="search-label">
              <Search size={16} />
              <input
                aria-label="Поиск задач"
                placeholder="Номер или название задачи"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {catalog.map((item) => (
              <div key={item.id} className="picker-row">
                <div>
                  <strong className="mono">{item.key}</strong> <span>{item.title}</span>
                  <small>
                    {item.deployedRelease
                      ? 'Внедрена · ' + item.deployedRelease.key
                      : workLabels[item.status]}{' '}
                    · {item.assignee?.displayName ?? 'Не назначен'}
                  </small>
                </div>
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    !!item.deployedRelease || selected.some((entry) => entry.key === item.key)
                  }
                  aria-label={'Добавить ' + item.key}
                  onClick={() => choose(item)}
                >
                  Добавить
                </button>
              </div>
            ))}
            {!catalog.length && <p className="muted">Задачи не найдены.</p>}
          </div>
        )}
        {pending && (
          <Alert>
            <strong>
              {pending.key} ·{' '}
              {pending.status === 'IN_TEST'
                ? 'Задача ещё не прошла проверку'
                : workLabels[pending.status]}
            </strong>
            <p>Её можно запланировать в черновике. Согласование доступно после проверки.</p>
            <div className="actions">
              <button className="secondary" type="button" onClick={() => addItem(pending)}>
                Добавить в план
              </button>
              <button className="quiet" type="button" onClick={() => setPending(null)}>
                Отмена
              </button>
            </div>
          </Alert>
        )}
        <ScopeAlerts blockers={scope.blockers} />
        {scope.dependencies
          .filter((entry) => !entry.included)
          .map((entry) => (
            <div className="detail-row" key={entry.key + entry.requiredKey}>
              <span>
                {entry.key} требует {entry.requiredKey}
                {entry.release && ' · внедрена в ' + entry.release}
              </span>
              {!entry.release && (
                <button
                  className="secondary"
                  type="button"
                  onClick={() => void chooseDependency(entry.requiredKey)}
                >
                  Добавить в план
                </button>
              )}
            </div>
          ))}
      </section>
      <section className="panel form-stack">
        <div className="panel-heading">
          <h2>Окно внедрения</h2>
          <button
            type="button"
            className="secondary"
            disabled={!systemId || !starts || !ends}
            onClick={() => void checkWindow()}
          >
            <CalendarClock size={16} /> Проверить окно
          </button>
        </div>
        <div className="form-grid">
          <label>
            <span>Начало, МСК</span>
            <input
              type="datetime-local"
              value={starts}
              onChange={(e) => {
                setStarts(e.target.value);
                setPreview(null);
                setCalendar(null);
              }}
            />
          </label>
          <label>
            <span>Окончание, МСК</span>
            <input
              type="datetime-local"
              value={ends}
              onChange={(e) => {
                setEnds(e.target.value);
                setPreview(null);
                setCalendar(null);
              }}
            />
          </label>
        </div>
        {calendar && (
          <>
            <CalendarCheck result={calendar} apply={(window) => void applyWindow(window)} />
            {!!calendar.route?.length && (
              <p className="muted">
                {calendar.route.map((stage) => stageLabels[stage]).join(' → ')}
              </p>
            )}
          </>
        )}
      </section>
      {mode === 'draft' && (
        <section className="panel form-stack">
          <h2>План отката</h2>
          <label>
            <span>Действия при сбое</span>
            <textarea
              value={plan}
              placeholder="Как вернуть предыдущую версию и проверить сервис"
              onChange={(e) => setPlan(e.target.value)}
            />
          </label>
        </section>
      )}
      {preview && (
        <section className="panel form-stack" aria-label="Последствия изменений">
          <h2>Последствия изменений</h2>
          <div className="detail-row">
            <span>
              {windowLabel(preview.previousWindow.startsAt, preview.previousWindow.endsAt)}
            </span>
            <ArrowRight size={16} />
            <span>{windowLabel(preview.window.startsAt, preview.window.endsAt)}</span>
          </div>
          {!!preview.addedItemKeys.length && (
            <p>Добавлены задачи {preview.addedItemKeys.join(', ')}</p>
          )}
          {!!preview.removedItemKeys.length && (
            <p>Удалены задачи {preview.removedItemKeys.join(', ')}</p>
          )}
          {preview.previousTag !== preview.gitlabTagUrl && <p>Изменён тег GitLab.</p>}
          {preview.steps.map((step) => (
            <div className="detail-row" key={step.stage}>
              <div>
                <strong>{stageLabels[step.stage]}</strong>
                <br />
                <small>{step.reason}</small>
              </div>
              <span className={'effect effect-' + step.effect.toLowerCase()}>
                {effectLabels[step.effect]}
              </span>
            </div>
          ))}
          {preview.nextAssignee && <p>Следующее действие · {preview.nextAssignee.displayName}</p>}
          <CalendarCheck result={preview.calendar} apply={(window) => void applyWindow(window)} />
          <ScopeAlerts blockers={preview.blockers} />
        </section>
      )}
      {errorMessage && <Alert>{errorMessage}</Alert>}
      <div className="actions form-actions">
        {mode === 'change' ? (
          <>
            <button
              className="primary"
              value={preview ? 'confirm' : 'preview'}
              type="submit"
              disabled={busy || !!preview?.blockers.length || !!preview?.calendar.conflicts.length}
            >
              {preview ? 'Подтвердить изменения' : 'Проверить изменения'}
            </button>
            {preview && (
              <button className="secondary" type="button" onClick={() => setPreview(null)}>
                Продолжить редактирование
              </button>
            )}
          </>
        ) : (
          <>
            <button
              className="primary"
              type="submit"
              value="submit"
              disabled={
                busy ||
                !!scope.blockers.length ||
                !title.trim() ||
                !plan.trim() ||
                !starts ||
                !ends ||
                !selected.length
              }
            >
              Отправить на согласование
            </button>
            <button className="secondary" type="submit" value="save" disabled={busy}>
              Сохранить черновик
            </button>
          </>
        )}
      </div>
    </form>
  );
}
