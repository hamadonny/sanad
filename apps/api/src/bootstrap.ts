import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import compression from 'compression';
import type { Express, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { bigintReplacer } from './common/money.js';

/** Shared app configuration for main.ts, tests and the OpenAPI generator. */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  (app.getHttpAdapter().getInstance() as Express).set('json replacer', bigintReplacer);
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', 1);
  app.enableShutdownHooks();
  // Security headers (HSTS, no sniffing, no framing, no referrer leaks). The API serves JSON and
  // files only, so the content security policy can be the strictest possible.
  const strict = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: process.env.NODE_ENV === 'production',
  });
  // Swagger UI (development only) needs its own scripts and styles.
  const docs = helmet({ contentSecurityPolicy: false, hsts: false });
  app.use((req: Request, res: Response, next: NextFunction) =>
    req.path.startsWith('/docs') ? docs(req, res, next) : strict(req, res, next),
  );
  app.use(compression({ threshold: 1024 }));
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
      'Digital jamiya, organised by Sanad. Money is integer fils as strings (1 KWD = 1,000 fils).',
    )
    .setVersion('0.2.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}
