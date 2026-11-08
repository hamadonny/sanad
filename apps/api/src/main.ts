import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { configureApp, openApiDocument } from './bootstrap.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);
  SwaggerModule.setup('docs', app, openApiDocument(app));
  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port);
  Logger.log(`Sanad API on http://localhost:${port} — docs at /docs`, 'Bootstrap');
}

void bootstrap();
