import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { configureApp, openApiDocument } from './bootstrap.js';
import { loadEnv } from './config/env.js';
import { runMigrations } from './db/migrate.js';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  if (env.MIGRATE_ON_START) {
    // Development convenience: a fresh database works without running db:migrate first.
    try {
      await runMigrations(env.DATABASE_URL);
      Logger.log('Database migrations are up to date', 'Bootstrap');
    } catch (e) {
      Logger.error(
        `Could not migrate the database at startup (${e instanceof Error ? e.message : String(e)}). ` +
          'Is Postgres running? Try "pnpm infra:up".',
        'Bootstrap',
      );
    }
  }
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);
  // Interactive API docs are for developers; never exposed in production.
  if (env.NODE_ENV !== 'production') SwaggerModule.setup('docs', app, openApiDocument(app));
  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port);
  Logger.log(
    `Sanad API on http://localhost:${port}${env.NODE_ENV !== 'production' ? ' — docs at /docs' : ''}`,
    'Bootstrap',
  );
}

void bootstrap();
