/** Writes openapi.json (used to generate @sanad/api-client). No DB or Redis needed. */
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp, openApiDocument } from './bootstrap.js';

const app = await NestFactory.create(AppModule, { logger: false, abortOnError: true });
configureApp(app);
const out = fileURLToPath(new URL('../../../packages/api-client/openapi.json', import.meta.url));
writeFileSync(out, `${JSON.stringify(openApiDocument(app), null, 2)}\n`);
await app.close();
console.log(`wrote ${out}`);
