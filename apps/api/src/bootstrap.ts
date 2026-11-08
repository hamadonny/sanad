import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { Express } from 'express';
import { bigintReplacer } from './common/money.js';

/** Shared app configuration for main.ts, tests and the OpenAPI generator. */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  (app.getHttpAdapter().getInstance() as Express).set('json replacer', bigintReplacer);
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', 1);
  app.enableShutdownHooks();
  // Browsers only: the admin dashboard and the mobile web preview. Native apps don't use CORS.
  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length > 0 ? origins : process.env.NODE_ENV !== 'production',
    credentials: false,
  });
}

export function openApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Sanad API')
    .setDescription(
      'Guaranteed digital jamiya. Money is integer fils as strings (1 KWD = 1,000 fils).',
    )
    .setVersion('0.2.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}
