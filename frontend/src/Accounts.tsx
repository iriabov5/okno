import { useEffect, useState, type SubmitEvent } from 'react';
import { Plus } from 'lucide-react';
import { api, message } from './api';
import { roleLabels } from './labels';
import type { Person, Role } from './types';
import { Alert, Modal } from './ui';

type Account = Person & { login: string };
const roleOptions = Object.entries(roleLabels).map(([value, label]) => (
  <option key={value} value={value}>
    {label}
  </option>
));

function NewAccount({
  onClose,
  onCreated,
}: Readonly<{
  onClose: () => void;
  onCreated: (account: Account) => void;
}>) {
  const [errorMessage, setErrorMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErrorMessage('');
    try {
      const form = Object.fromEntries(new FormData(event.currentTarget));
      onCreated(await api<Account>('/admin/users', 'POST', form));
    } catch (error) {
      setErrorMessage(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Новый пользователь" onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <label>
          <span>Имя</span>
          <input name="displayName" required maxLength={100} />
        </label>
        <label>
          <span>Логин</span>
          <input name="login" required minLength={3} maxLength={80} autoComplete="off" />
        </label>
        <label>
          <span>Пароль</span>
          <input
            name="password"
            type="password"
            required
            minLength={10}
            maxLength={200}
            autoComplete="new-password"
          />
        </label>
        <label>
          Роль<select name="role">{roleOptions}</select>
        </label>
        {errorMessage && <Alert>{errorMessage}</Alert>}
        <button type="submit" className="primary" disabled={busy}>
          Создать пользователя
        </button>
      </form>
    </Modal>
  );
}

export function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>();
  const [errorMessage, setErrorMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    api<{ items: Account[] }>('/admin/users')
      .then((data) => setAccounts(data.items))
      .catch((error: unknown) => setErrorMessage(message(error)));
  }, []);
  async function changeRole(account: Account, role: Role) {
    setPending(account.id);
    setErrorMessage('');
    try {
      const updated = await api<Account>('/admin/users/' + account.id + '/role', 'PATCH', { role });
      setAccounts((previous) =>
        previous?.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
    } catch (error) {
      setErrorMessage(message(error));
    } finally {
      setPending(null);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Пользователи</h1>
          <p>Учётные записи команды и рабочие роли.</p>
        </div>
        <button type="button" className="primary" onClick={() => setCreating(true)}>
          <Plus size={18} /> Новый пользователь
        </button>
      </div>
      {errorMessage && <Alert>{errorMessage}</Alert>}
      {!accounts && !errorMessage && <p>Загрузка…</p>}
      {accounts && (
        <section className="panel account-list" aria-label="Список пользователей">
          {accounts.map((account) => (
            <div className="detail-row" key={account.id}>
              <div>
                <strong>{account.displayName}</strong>
                <br />
                <small className="mono">{account.login}</small>
              </div>
              {account.role === 'ADMIN' ? (
                <span className="status">{roleLabels.ADMIN}</span>
              ) : (
                <select
                  aria-label={'Роль ' + account.login}
                  value={account.role}
                  disabled={pending !== null}
                  onChange={(e) => void changeRole(account, e.target.value as Role)}
                >
                  {roleOptions}
                </select>
              )}
            </div>
          ))}
        </section>
      )}
      {creating && (
        <NewAccount
          onClose={() => setCreating(false)}
          onCreated={(account) => {
            setAccounts((previous) =>
              [...(previous ?? []), account].sort((a, b) => a.login.localeCompare(b.login)),
            );
            setCreating(false);
          }}
        />
      )}
    </>
  );
}
