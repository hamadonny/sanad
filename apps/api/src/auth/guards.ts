import {
  createParamDecorator,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { forbidden } from '../common/errors.js';
import { DbService } from '../db/db.service.js';
import { adminUsers } from '../db/schema.js';
import { TokensService } from './tokens.service.js';

export const ADMIN_ROLES = [
  'super_admin',
  'ops',
  'kyc_reviewer',
  'finance',
  'legal',
  'viewer',
] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export interface MemberPrincipal {
  id: string;
}
export interface AdminPrincipal {
  id: string;
  email: string;
  roles: AdminRole[];
}

type AuthedRequest = Request & { member?: MemberPrincipal; admin?: AdminPrincipal };

function bearer(req: Request): string {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : '';
}

@Injectable()
export class MemberGuard implements CanActivate {
  constructor(private readonly tokens: TokensService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const { sub } = await this.tokens.verifyAccess('member', bearer(req));
    req.member = { id: sub };
    return true;
  }
}

const ROLES_KEY = 'sanad:roles';
/** Allowed admin roles for a route; `super_admin` is always allowed. Omit = any admin. */
export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly tokens: TokensService,
    private readonly dbs: DbService,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const { sub } = await this.tokens.verifyAccess('admin', bearer(req));
    const [admin] = await this.dbs.db.select().from(adminUsers).where(eq(adminUsers.id, sub));
    if (!admin?.active) throw forbidden('ADMIN_DISABLED', 'admin account disabled');
    const roles = admin.roles as AdminRole[];
    const required = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (
      required &&
      required.length > 0 &&
      !roles.includes('super_admin') &&
      !required.some((r) => roles.includes(r))
    ) {
      throw forbidden('ROLE_REQUIRED', `requires one of: ${required.join(', ')}`);
    }
    // Mutations by read-only admins are never allowed.
    if (roles.length === 1 && roles[0] === 'viewer' && req.method !== 'GET')
      throw forbidden('READ_ONLY', 'viewer role is read-only');
    req.admin = { id: admin.id, email: admin.email, roles };
    return true;
  }
}

export const CurrentMember = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): MemberPrincipal => {
    return ctx.switchToHttp().getRequest<AuthedRequest>().member as MemberPrincipal;
  },
);

export const CurrentAdmin = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): AdminPrincipal => {
    return ctx.switchToHttp().getRequest<AuthedRequest>().admin as AdminPrincipal;
  },
);

export const ClientIp = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): string | null => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return req.ip ?? null;
  },
);
