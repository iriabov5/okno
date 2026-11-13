import { useEffect, useState, type SubmitEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { CalendarDays, ClipboardList, LayoutGrid, ListChecks, LogOut, Users } from 'lucide-react';
import { api, message, RequestError } from './api';
import { Accounts } from './Accounts';
import { Board } from './Board';
import { Planning } from './Planning';
import { roleLabels } from './labels';
import { ReleaseEditor } from './ReleaseEditor';
import { ReleaseList, ReleasePage } from './Releases';
import type { Person, System } from './types';
import { Alert, Logo } from './ui';
import './style.css';

const roles = [
  ['engineer', 'Инженер'],
  ['admin', 'Администратор'],
  ['developer', 'Исполнитель'],
  ['qa', 'Тестировщик'],
  ['owner', 'Владелец системы'],
  ['operations', 'Эксплуатация'],
  ['duty', 'Дежурный'],
];

function Login({ onLogin }: Readonly<{ onLogin: (person: Person) => void }>) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [signupEnabled, setSignupEnabled] = useState(false);
  const [register, setRegister] = useState(false);
  const [displayName, setDisplayName] = useState('');
  useEffect(() => {
    api<{ signupEnabled: boolean }>('/auth/options')
      .then((data) => setSignupEnabled(data.signupEnabled))
      .catch(() => setSignupEnabled(false));
  }, []);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setErrorMessage('');
    setBusy(true);
    try {
      onLogin(
        await api<Person>(
          register ? '/auth/register' : '/auth/login',
          'POST',
          register ? { login, password, displayName } : { login, password },
        ),
      );
    } catch (error) {
      setErrorMessage(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <section className="login-intro">
        <Logo />
        <div>
          <h1>Задачи и релизы</h1>
          <p>Ведите задачи команды, согласуйте окно и зафиксируйте, что вошло в релиз.</p>
        </div>
        <ol>
          <li>Задача на доске</li>
          <li>Окно и согласование</li>
          <li>Факт внедрения</li>
        </ol>
      </section>
      <section className="login-content">
        <form onSubmit={(event) => void submit(event)} className="login-form form-stack">
          <h2>{register ? 'Создать учётную запись' : 'Войти в «Окно»'}</h2>
          {register && (
            <label>
              <span>Имя</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                maxLength={100}
              />
            </label>
          )}
          <label>
            <span>Логин</span>
            <input
              autoComplete="username"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              required
            />
          </label>
          <label>
            <span>Пароль</span>
            <input
              type="password"
              autoComplete={register ? 'new-password' : 'current-password'}
              minLength={register ? 10 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {errorMessage && <Alert>{errorMessage}</Alert>}
          <button className="primary" type="submit" disabled={busy}>
            {register ? 'Зарегистрироваться' : 'Войти'}
          </button>
          {signupEnabled && (
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setRegister(!register);
                setPassword('');
                setErrorMessage('');
              }}
            >
              {register ? 'Вернуться ко входу' : 'Создать учётную запись'}
            </button>
          )}
          {!register && import.meta.env.VITE_DEMO_MODE === 'true' && (
            <div className="demo-login">
              <h3>Демо-учётные записи</h3>
              <div>
                {roles.map(([key, label]) => (
                  <button
                    type="button"
                    className="secondary"
                    key={key}
                    onClick={() => {
                      setLogin(key ?? '');
                      setPassword('okno-demo');
                      setErrorMessage('');
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
      </section>
    </main>
  );
}

function WorkspacePage({
  page,
  person,
  systems,
  people,
}: Readonly<{ page: string; person: Person; systems: System[]; people: Person[] }>) {
  switch (page) {
    case 'accounts':
      return person.role === 'ADMIN' ? (
        <Accounts />
      ) : (
        <Alert>Раздел доступен администратору.</Alert>
      );
    case 'board':
      return <Board person={person} people={people} systems={systems} />;
    case 'new-release':
      return (
        <ReleaseEditor
          mode="draft"
          systems={systems}
          onCancel={() => {
            location.hash = 'releases';
          }}
          onSaved={(card) => {
            location.hash = 'release/' + card.id;
          }}
        />
      );
    default:
      if (page === 'planning' || page.startsWith('planning/'))
        return (
          <Planning person={person} systems={systems} people={people} epicId={page.slice(9)} />
        );
      if (page.startsWith('release/'))
        return <ReleasePage id={page.slice(8)} key={page} systems={systems} />;
      return <ReleaseList key={page} queue={page === 'queue'} person={person} />;
  }
}

function App() {
  const [person, setPerson] = useState<Person | null>();
  const [systems, setSystems] = useState<System[]>();
  const [people, setPeople] = useState<Person[]>([]);
  const [page, setPage] = useState(() => location.hash.slice(1) || 'board');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const update = () => {
      setPage(location.hash.slice(1) || 'board');
      window.scrollTo(0, 0);
    };
    const expire = () => {
      setPerson(null);
      setSystems(undefined);
    };
    window.addEventListener('hashchange', update);
    window.addEventListener('okno-session-expired', expire);
    return () => {
      window.removeEventListener('hashchange', update);
      window.removeEventListener('okno-session-expired', expire);
    };
  }, []);
  useEffect(() => {
    api<Person>('/me')
      .then(setPerson)
      .catch((error: unknown) => {
        if (error instanceof RequestError && error.status === 401) setPerson(null);
        else setErrorMessage(message(error));
      });
  }, []);
  useEffect(() => {
    if (!person) return;
    Promise.all([api<{ items: System[] }>('/systems'), api<{ items: Person[] }>('/people')])
      .then(([systemsResult, peopleResult]) => {
        setSystems(systemsResult.items);
        setPeople(peopleResult.items);
      })
      .catch((error: unknown) => setErrorMessage(message(error)));
  }, [person]);

  if (person === undefined)
    return (
      <main className="content">
        {errorMessage ? <Alert>{errorMessage}</Alert> : <p>Загрузка…</p>}
      </main>
    );
  if (person === null)
    return (
      <Login
        onLogin={(user) => {
          setPerson(user);
          location.hash = 'board';
        }}
      />
    );
  const nav = [
    { id: 'board', label: 'Доска', icon: LayoutGrid },
    { id: 'planning', label: 'Планирование', icon: CalendarDays },
    { id: 'releases', label: 'Мои заявки', icon: ClipboardList },
    { id: 'queue', label: 'На согласовании', icon: ListChecks },
  ];
  if (person.role === 'ADMIN') nav.push({ id: 'accounts', label: 'Пользователи', icon: Users });
  const section = page.split('/')[0];
  const active = nav.some(({ id }) => id === section) ? section : 'releases';
  return (
    <>
      <header className="header">
        <div className="header-inner">
          <a href="#board" aria-label="Окно, на доску">
            <Logo />
          </a>
          <nav aria-label="Основная навигация">
            {nav.map(({ id, label, icon: Icon }) => (
              <a key={id} href={'#' + id} aria-current={active === id ? 'page' : undefined}>
                <Icon size={17} />
                {label}
              </a>
            ))}
          </nav>
          <div className="profile">
            <span className="avatar">
              {person.displayName
                .split(' ')
                .slice(0, 2)
                .map((word) => word[0])
                .join('')}
            </span>
            <div>
              <strong>{person.displayName}</strong>
              <small>{roleLabels[person.role]}</small>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Выйти"
              title="Выйти"
              onClick={() => {
                void api('/auth/logout', 'POST')
                  .then(() => {
                    setPerson(null);
                    setSystems(undefined);
                  })
                  .catch((error: unknown) => setErrorMessage(message(error)));
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </header>
      <main className="content">
        {errorMessage && <Alert>{errorMessage}</Alert>}
        {!systems && <p>Загрузка рабочего пространства…</p>}
        {systems && <WorkspacePage page={page} person={person} systems={systems} people={people} />}
      </main>
    </>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
