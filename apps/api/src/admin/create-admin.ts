/**
 * Create an admin user:  pnpm --filter @sanad/api admin:create -- you@company.com "long password" super_admin,finance
 * Prints the TOTP secret once — add it to an authenticator app (2FA is mandatory).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { ADMIN_ROLES, type AdminRole } from '../auth/guards.js';
import { AdminService } from './admin.service.js';

const [email, password, rolesArg = 'viewer'] = process.argv.slice(2).filter((a) => a !== '--');
if (!email || !password) {
  console.error('usage: admin:create <email> <password> [roles,comma,separated]');
  process.exit(1);
}
const roles = rolesArg.split(',') as AdminRole[];
if (!roles.every((r) => (ADMIN_ROLES as readonly string[]).includes(r))) {
  console.error(`roles must be from: ${ADMIN_ROLES.join(', ')}`);
  process.exit(1);
}
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
const { totpSecret } = await app.get(AdminService).createAdmin(email, password, roles);
console.log(
  `created ${email} (${roles.join(', ')})\nTOTP secret: ${totpSecret}\notpauth://totp/Sanad:${encodeURIComponent(email)}?secret=${totpSecret}&issuer=Sanad`,
);
await app.close();
