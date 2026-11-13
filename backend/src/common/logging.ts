import { ConsoleLogger, Logger, type LogLevel } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Person } from './types.js';

interface RequestLog {
  requestId: string;
  actorId?: string;
  role?: Person['role'];
  errorCode?: string;
  errorType?: string;
  stackFrames?: string[];
  activity?: {
    action: string;
    key: string;
    fromStatus?: string;
    toStatus?: string;
  };
}

const requestLogs = new AsyncLocalStorage<RequestLog>();
const http = new Logger('HTTP');
const levels: Record<string, LogLevel[]> = {
  TRACE: ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'],
  DEBUG: ['fatal', 'error', 'warn', 'log', 'debug'],
  INFO: ['fatal', 'error', 'warn', 'log'],
  WARN: ['fatal', 'error', 'warn'],
  ERROR: ['fatal', 'error'],
};

/** В текстовом выводе Nest уровень LOG соответствует INFO. */
export function applicationLogger() {
  if (process.env.NODE_ENV === 'test' && !process.env.LOG_LEVEL) return false;
  const level = (process.env.LOG_LEVEL ?? 'INFO').trim().toUpperCase();
  return new ConsoleLogger({
    logLevels: Object.hasOwn(levels, level) ? levels[level] : levels.INFO,
    json: process.env.LOG_FORMAT === 'json',
    compact: true,
  });
}

/** Добавляет к записи HTTP-запроса только технические данные и идентификаторы. */
export function requestLog(fields: Partial<Omit<RequestLog, 'requestId'>>): void {
  const current = requestLogs.getStore();
  if (current) Object.assign(current, fields);
}

export function logHttp(request: Request, response: Response, next: NextFunction): void {
  const context: RequestLog = { requestId: randomUUID() };
  const startedAt = performance.now();
  response.setHeader('X-Request-Id', context.requestId);
  response.once('finish', () => {
    const route: unknown = request.route?.path;
    const status = response.statusCode;
    const record = {
      ...context,
      method: request.method,
      route: typeof route === 'string' ? route : undefined,
      status,
      durationMs: Math.round(performance.now() - startedAt),
    };
    if (status >= 500) http.error(record);
    else if (
      status === 403 ||
      status === 409 ||
      (status === 401 && route === '/api/v1/auth/login')
    ) {
      http.warn(record);
    } else if (status < 400 && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
      if (typeof route === 'string' && route.endsWith('/preview')) http.debug(record);
      else http.log(record);
    } else http.debug(record);
  });
  requestLogs.run(context, next);
}
