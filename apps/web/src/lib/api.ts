export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

import { notify } from './notify';

const BASE = '/api';

async function request<T>(path: string, init: RequestInit = {}, silent = false): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-st-csrf': '1',
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  const text = await res.text();
  const data = text ? safeParse(text) : null;

  if (!res.ok) {
    const payload = data as { message?: string | string[]; code?: string } | null;
    const raw = payload?.message;
    const message = Array.isArray(raw) ? raw.join(', ') : raw ?? res.statusText;
    // Semua kegagalan aksi (bukan GET/polling) muncul sebagai toast global.
    if (!silent && init.method && init.method !== 'GET') notify(message, 'error');
    throw new ApiError(message, res.status, payload?.code);
  }
  return data as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>(path, init),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  postSilent: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }, true),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const out = search.toString();
  return out ? '?' + out : '';
};
