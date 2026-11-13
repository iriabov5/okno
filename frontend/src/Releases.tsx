import { useEffect, useState, type SubmitEvent } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  Check,
  ChevronRight,
  GitBranch,
  History,
  PackageCheck,
  Plus,
} from 'lucide-react';
import { api, message } from './api';
import {
  dateLabel,
  moscowInput,
  moscowValue,
  releaseLabels,
  stageLabels,
  windowLabel,
} from './labels';
import { CalendarCheck, ReleaseEditor, ScopeAlerts } from './ReleaseEditor';
import type { Person, ReleaseCard, ReleaseStatus, ReleaseSummary, System } from './types';
import { Alert, Empty, Modal } from './ui';

const states: Record<string, string> = {
  APPROVED: 'Согласовано',
  ACTIVE: 'На проверке',
  RECHECK: 'Повторная проверка',
  PENDING_RECHECK: 'Ожидает повторной проверки',
  PENDING: 'Ожидает',
};
const dialogTitles = {
  return: 'Вернуть на доработку',
  deploy: 'Отметить внедрение',
  attach: 'GitLab Release',
};
const historyLabels: Record<string, string> = {
  CREATED: 'Создан черновик',
  DRAFT_EDITED: 'Черновик обновлён',
  SUBMITTED: 'Отправлено на согласование',
  APPROVED: 'Этап согласован',
  RETURNED: 'Возвращено на доработку',
  CHANGED: 'Заявка изменена',
  DEPLOYED: 'Подтверждено внедрение',
  GITLAB_RELEASE_LINKED: 'Добавлена ссылка на GitLab Release',
};

function Status({ status }: Readonly<{ status: ReleaseStatus }>) {
  return <span className={'status status-' + status.toLowerCase()}>{releaseLabels[status]}</span>;
}

export function ReleaseList({ queue, person }: Readonly<{ queue: boolean; person: Person }>) {
  const [items, setItems] = useState<ReleaseSummary[]>();
  const [errorMessage, setErrorMessage] = useState('');
  useEffect(() => {
    let current = true;
    api<{ items: ReleaseSummary[] }>(queue ? '/approval-tasks' : '/release-requests')
      .then((data) => {
        if (current) setItems(data.items);
      })
      .catch((error: unknown) => {
        if (current) setErrorMessage(message(error));
      });
    return () => {
      current = false;
    };
  }, [queue]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{queue ? 'На согласовании' : 'Мои заявки'}</h1>
          <p>
            {queue
              ? 'Заявки, которые ждут вашего решения.'
              : 'Окна, состав релизов и история согласования.'}
          </p>
        </div>
        {!queue && person.role === 'ENGINEER' && (
          <a className="primary" href="#new-release">
            <Plus size={18} /> Новая заявка
          </a>
        )}
      </div>
      {errorMessage && <Alert>{errorMessage}</Alert>}
      {!items && !errorMessage && <p>Загрузка…</p>}
      {items && !items.length && (
        <Empty>
          {queue ? 'Нет заявок, ожидающих вашего решения.' : 'Здесь появятся ваши заявки на релиз.'}
        </Empty>
      )}
      {!!items?.length && (
        <section className="panel release-list">
          {items.map((item) => (
            <a className="release-row" key={item.taskId ?? item.id} href={'#release/' + item.id}>
              <div>
                <small className="mono">
                  {item.key}
                  {item.systemName && ' · ' + item.systemName}
                </small>
                <strong>{item.title || 'Черновик без названия'}</strong>
              </div>
              <span>
                {item.stage ? stageLabels[item.stage] + ' · ' : ''}
                {windowLabel(item.startsAt, item.endsAt)}
              </span>
              <Status status={item.status} />
              <ChevronRight size={18} />
            </a>
          ))}
        </section>
      )}
    </>
  );
}

export function ReleasePage({ id, systems }: Readonly<{ id: string; systems: System[] }>) {
  const [card, setCard] = useState<ReleaseCard>();
  const [mode, setMode] = useState<'draft' | 'change' | null>(null);
  const [modal, setModal] = useState<'return' | 'deploy' | 'attach' | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [link, setLink] = useState('');
  const [actualTime, setActualTime] = useState('');

  useEffect(() => {
    let current = true;
    api<ReleaseCard>('/release-requests/' + id)
      .then((result) => {
        if (current) setCard(result);
      })
      .catch((error: unknown) => {
        if (current) setErrorMessage(message(error));
      });
    return () => {
      current = false;
    };
  }, [id]);

  function actionAllowed(action: string) {
    return card?.availableActions.includes(action) ?? false;
  }
  function openModal(kind: typeof modal) {
    setErrorMessage('');
    setComment('');
    setLink(card?.gitlabReleaseUrl ?? '');
    const minute = Math.floor(Date.now() / 60_000) * 60_000;
    const insideWindow =
      card?.startsAt &&
      card.endsAt &&
      minute >= Date.parse(card.startsAt) &&
      minute < Date.parse(card.endsAt);
    setActualTime(insideWindow ? moscowInput(new Date(minute).toISOString()) : '');

    setModal(kind);
  }

  async function write(path: string, payload: Record<string, unknown>, method = 'POST') {
    if (!card) return;
    setBusy(true);
    setErrorMessage('');
    try {
      setCard(
        await api<ReleaseCard>(path, method, { ...payload, expectedRevision: card.revision }),
      );
      setModal(null);
    } catch (error) {
      setErrorMessage(message(error));
      const refreshed = await api<ReleaseCard>('/release-requests/' + id).catch(() => null);
      if (refreshed) setCard(refreshed);
    } finally {
      setBusy(false);
    }
  }

  function decision(value: 'APPROVE' | 'RETURN') {
    if (card?.currentTaskId)
      void write('/approval-tasks/' + card.currentTaskId + '/decision', {
        decision: value,
        ...(value === 'RETURN' ? { comment } : {}),
      });
  }

  function modalSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (modal === 'return') decision('RETURN');
    if (modal === 'deploy')
      void write('/release-requests/' + id + '/deploy', {
        deployedAt: moscowValue(actualTime),
        gitlabReleaseUrl: link.trim() || null,
      });
    if (modal === 'attach')
      void write(
        '/release-requests/' + id + '/gitlab-release',
        { gitlabReleaseUrl: link.trim() },
        'PATCH',
      );
  }

  if (!card) return errorMessage ? <Alert>{errorMessage}</Alert> : <p>Загрузка заявки…</p>;
  if (mode)
    return (
      <ReleaseEditor
        card={card}
        mode={mode}
        systems={systems}
        onCancel={() => setMode(null)}
        onSaved={(result) => {
          setCard(result);
          setMode(null);
          setErrorMessage('');
        }}
      />
    );
  const currentStage = card.route.find(
    (step) => step.state === 'ACTIVE' || step.state === 'RECHECK',
  );
  const actionLabel = currentStage?.stage === 'OPERATIONS' ? 'Согласовать окно' : 'Согласовать';
  return (
    <>
      <a className="back-link" href="#releases">
        <ArrowLeft size={16} /> К заявкам
      </a>
      <div className="page-heading release-heading">
        <div>
          <div className="kicker">
            <span className="mono">{card.key}</span>
            <Status status={card.status} />
          </div>
          <h1>{card.title || 'Черновик без названия'}</h1>
          <p>{card.system?.name ?? 'Система не указана'}</p>
        </div>
        <div className="actions">
          {actionAllowed('EDIT') && (
            <button type="button" className="primary" onClick={() => setMode('draft')}>
              {card.status === 'DRAFT' ? 'Редактировать черновик' : 'Доработать заявку'}
            </button>
          )}
          {actionAllowed('DEPLOY') && (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => openModal('deploy')}
            >
              <PackageCheck size={18} /> Отметить внедрение
            </button>
          )}
          {actionAllowed('CHANGE') && (
            <button
              type="button"
              className={actionAllowed('DEPLOY') ? 'secondary' : 'primary'}
              onClick={() => setMode('change')}
            >
              Проверить другое окно
            </button>
          )}
          {actionAllowed('APPROVE') && (
            <button
              type="button"
              className="primary"
              disabled={busy || !!card.blockers.length || !!card.calendarConflicts.length}
              onClick={() => decision('APPROVE')}
            >
              {actionLabel}
            </button>
          )}
          {actionAllowed('RETURN') && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => openModal('return')}
            >
              Вернуть с комментарием
            </button>
          )}
        </div>
      </div>
      {card.currentAssignee && (
        <div className="now-bar">
          <span></span>
          <strong>Сейчас на согласовании</strong> {card.currentAssignee.displayName}
          {currentStage && ' · ' + currentStage.label}
        </div>
      )}
      {errorMessage && !modal && <Alert>{errorMessage}</Alert>}
      <ScopeAlerts blockers={card.blockers} />
      {!!card.calendarConflicts.length && (
        <CalendarCheck
          result={{ conflicts: card.calendarConflicts, suggestedWindow: card.suggestedWindow }}
        />
      )}
      <div className="release-layout">
        <div className="release-main">
          <section className="panel">
            <h2>Маршрут согласования</h2>
            <ol className="route">
              {card.route.map((step) => (
                <li key={step.stage} className={'route-step ' + step.state.toLowerCase()}>
                  <span className="step-symbol">
                    {step.state === 'APPROVED' ? <Check size={15} /> : <span />}
                  </span>
                  <div>
                    <strong>{step.label}</strong>
                    <small>
                      {step.assignee?.displayName ?? 'Исполнитель уточнится'} ·{' '}
                      {states[step.state] ?? step.state}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          </section>
          <section className="panel">
            <h2>
              Состав релиза <span className="count">{card.items.length}</span>
            </h2>
            {card.items.map((item) => (
              <div className="detail-row" key={item.key}>
                <strong className="mono">{item.key}</strong>
                <span>
                  {item.title}
                  <small className="planning-item-context">{item.sprint?.name ?? 'Бэклог'}</small>
                </span>
              </div>
            ))}
            {!card.items.length && <p className="muted">Состав пока пуст.</p>}
          </section>
          <section className="panel">
            <h2>
              <History size={19} /> История
            </h2>
            {card.history.map((entry) => (
              <div className="history-entry" key={entry.createdAt + entry.type}>
                <div>
                  <strong>{historyLabels[entry.type] ?? entry.type}</strong>
                  {typeof entry.details.comment === 'string' && <p>{entry.details.comment}</p>}
                  {typeof entry.details.stage === 'string' &&
                    entry.details.stage in stageLabels && (
                      <p>{stageLabels[entry.details.stage as keyof typeof stageLabels]}</p>
                    )}
                  {Array.isArray(entry.details.addedItemKeys) &&
                    !!entry.details.addedItemKeys.length && (
                      <p>Добавлены {entry.details.addedItemKeys.join(', ')}</p>
                    )}
                  {Array.isArray(entry.details.removedItemKeys) &&
                    !!entry.details.removedItemKeys.length && (
                      <p>Удалены {entry.details.removedItemKeys.join(', ')}</p>
                    )}
                  {entry.type === 'CHANGED' &&
                    (() => {
                      const before = entry.details.previousWindow as
                        { startsAt?: string; endsAt?: string } | undefined;
                      const after = entry.details.window as
                        { startsAt?: string; endsAt?: string } | undefined;
                      return (
                        <>
                          {before?.startsAt &&
                            after?.startsAt &&
                            (before.startsAt !== after.startsAt ||
                              before.endsAt !== after.endsAt) && (
                              <p>
                                {windowLabel(before.startsAt, before.endsAt)} →{' '}
                                {windowLabel(after.startsAt, after.endsAt)}
                              </p>
                            )}
                          {entry.details.previousTag !== entry.details.gitlabTagUrl && (
                            <p>Изменён тег GitLab.</p>
                          )}
                          {Array.isArray(entry.details.steps) &&
                            entry.details.steps
                              .filter(
                                (step) =>
                                  step.effect === 'RECHECK' ||
                                  step.effect === 'ADD' ||
                                  step.effect === 'REMOVE',
                              )
                              .map((step: { stage: keyof typeof stageLabels; reason: string }) => (
                                <p key={step.stage}>
                                  {stageLabels[step.stage]} · {step.reason}
                                </p>
                              ))}
                        </>
                      );
                    })()}
                </div>
                <small>
                  {entry.actor} · {dateLabel(entry.createdAt)}
                </small>
              </div>
            ))}
          </section>
        </div>
        <aside className="release-side">
          <section className="panel">
            <h2>
              <CalendarClock size={19} /> Время внедрения
            </h2>
            <p>{windowLabel(card.startsAt, card.endsAt)}</p>
            {card.deployedAt && (
              <div className="positive">
                <Check size={16} /> Факт · {dateLabel(card.deployedAt)}
              </div>
            )}
            <small className="muted">Московское время</small>
          </section>
          <section className="panel">
            <h2>
              <GitBranch size={19} /> GitLab
            </h2>
            {card.gitlabTagUrl ? (
              <a className="external" href={card.gitlabTagUrl} target="_blank" rel="noreferrer">
                Тег GitLab <ArrowUpRight size={15} />
              </a>
            ) : (
              <p className="muted">Тег не указан.</p>
            )}
            {card.gitlabReleaseUrl && (
              <a className="external" href={card.gitlabReleaseUrl} target="_blank" rel="noreferrer">
                GitLab Release <ArrowUpRight size={15} />
              </a>
            )}
            {actionAllowed('CHANGE') && (
              <button type="button" className="secondary" onClick={() => setMode('change')}>
                {card.gitlabTagUrl ? 'Изменить тег' : 'Добавить тег'}
              </button>
            )}
            {actionAllowed('ATTACH_RELEASE') && (
              <button type="button" className="secondary" onClick={() => openModal('attach')}>
                {card.gitlabReleaseUrl ? 'Обновить ссылку' : 'Добавить GitLab Release'}
              </button>
            )}
          </section>
          {card.rollbackPlan && (
            <section className="panel">
              <h2>План отката</h2>
              <p className="preserve">{card.rollbackPlan}</p>
            </section>
          )}
        </aside>
      </div>
      {modal && (
        <Modal title={dialogTitles[modal]} onClose={() => setModal(null)}>
          <form className="form-stack" onSubmit={modalSubmit}>
            {modal === 'return' ? (
              <label>
                <span>Причина возврата</span>
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} required />
              </label>
            ) : (
              <>
                {modal === 'deploy' && (
                  <label>
                    <span>Фактическое время, МСК</span>
                    <input
                      type="datetime-local"
                      value={actualTime}
                      onChange={(e) => setActualTime(e.target.value)}
                      required
                    />
                  </label>
                )}
                <label>
                  Ссылка на GitLab Release {modal === 'deploy' && <small>необязательно</small>}
                  <input
                    type="url"
                    placeholder="https://gitlab.example.ru/team/project/-/releases/v1.2.0"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    required={modal === 'attach'}
                  />
                </label>
              </>
            )}
            {errorMessage && <Alert>{errorMessage}</Alert>}
            <div className="actions">
              <button type="submit" className="primary" disabled={busy}>
                {modal === 'return' ? 'Вернуть заявку' : 'Подтвердить'}
              </button>
              <button type="button" className="secondary" onClick={() => setModal(null)}>
                Отмена
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
