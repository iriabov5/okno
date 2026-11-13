import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { requestLog } from './logging.js';

export class ApiError extends HttpException {
  constructor(status: number, code: string, message: string, details?: unknown) {
    super({ code, message, details }, status);
  }
}

export function bad(message: string, code = 'INVALID_INPUT'): never {
  throw new ApiError(400, code, message);
}

export function missing(): never {
  throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Ресурс не найден.');
}

export function forbidden(): never {
  throw new ApiError(403, 'ACTION_FORBIDDEN', 'Действие недоступно для вашей роли.');
}

export function conflict(code: string, message: string, details?: unknown): never {
  throw new ApiError(409, code, message, details);
}

export function checkRevision(actual: number, expected: number): void {
  if (actual !== expected)
    conflict('STALE_REVISION', 'Карточка изменилась. Обновите данные и повторите действие.');
}

export function invalidState(): never {
  return conflict('INVALID_STATE', 'Действие недоступно в текущем состоянии.');
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (!(exception instanceof HttpException) || exception.getStatus() >= 500) {
      requestLog({
        errorType: exception instanceof Error ? exception.constructor.name : 'UnknownError',
        stackFrames:
          exception instanceof Error
            ? exception.stack
                ?.split('\n')
                .filter((line) => line.startsWith('    at '))
                .slice(0, 8)
            : undefined,
      });
      response
        .status(500)
        .json({ code: 'INTERNAL_SERVER_ERROR', message: 'Внутренняя ошибка сервера.' });
      return;
    }
    const status = exception.getStatus();
    const body =
      exception instanceof ApiError
        ? exception.getResponse()
        : {
            code: status === 404 ? 'RESOURCE_NOT_FOUND' : 'INVALID_INPUT',
            message: status === 404 ? 'Ресурс не найден.' : 'Проверьте параметры запроса.',
          };
    requestLog({
      errorCode: typeof body === 'object' && 'code' in body ? String(body.code) : undefined,
    });
    response.status(status).json(body);
  }
}
