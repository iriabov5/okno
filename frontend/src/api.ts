export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api/v1' + path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event('okno-session-expired'));
    }

    const error = await response.json().catch(() => ({}));
    throw new RequestError(
      response.status,
      error.code ?? 'REQUEST_FAILED',
      error.message ?? 'Не удалось выполнить запрос.',
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function message(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось выполнить действие.';
}

export function query(values: Record<string, string>) {
  const search = new URLSearchParams(Object.entries(values).filter(([, value]) => value));
  return search.size ? '?' + search.toString() : '';
}
