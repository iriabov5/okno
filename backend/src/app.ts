import 'reflect-metadata';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AuthModule, sessionCookie } from './auth/auth.js';
import { HttpErrorFilter } from './common/errors.js';
import { ErrorDto } from './common/http.js';
import { applicationLogger, logHttp } from './common/logging.js';
import { DatabaseModule } from './database/database.js';
import { PlanningModule } from './planning/controller.js';
import { ReleaseModule } from './releases/controller.js';
import { TrackerModule } from './tracker/controller.js';
import { DataSource } from 'typeorm';

@Module({ imports: [DatabaseModule, AuthModule, TrackerModule, ReleaseModule, PlanningModule] })
export class AppModule {}

export async function createApp() {
  const app = await NestFactory.create(AppModule, {
    logger: applicationLogger(),
  });
  app.use(logHttp);
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpErrorFilter());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
  const db = app.get(DataSource);
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  const swagger = new DocumentBuilder()
    .setTitle('Окно')
    .setDescription('Задачи команды, согласование окон и фиксация релизов')
    .setVersion('1.0')
    .addCookieAuth(sessionCookie, { type: 'apiKey', in: 'cookie' }, sessionCookie)
    .addGlobalResponse(
      { status: 400, type: ErrorDto, description: 'Проверьте параметры запроса' },
      { status: 401, type: ErrorDto, description: 'Требуется вход' },
      { status: 403, type: ErrorDto, description: 'Действие недоступно' },
      { status: 404, type: ErrorDto, description: 'Ресурс не найден' },
      {
        status: 409,
        type: ErrorDto,
        description: 'Данные изменились или действие пока недоступно',
      },
    )
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, swagger), {
    jsonDocumentUrl: 'api.json',
    yamlDocumentUrl: 'api.yaml',
  });
  return { app, db };
}
