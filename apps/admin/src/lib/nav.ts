import type { AdminRole } from '@sanad/api-client';

export type NavKey =
  | 'overview'
  | 'kyc'
  | 'circles'
  | 'members'
  | 'payments'
  | 'legal'
  | 'finance'
  | 'config'
  | 'content'
  | 'support'
  | 'monitoring'
  | 'audit';

/**
 * Which roles see each section (mirrors the API's @Roles; the API is the real gate).
 * `super_admin` sees everything. Empty = every admin.
 */
export const NAV: { key: NavKey; href: string; roles: AdminRole[] }[] = [
  { key: 'overview', href: '/', roles: [] },
  { key: 'kyc', href: '/kyc', roles: ['kyc_reviewer', 'ops'] },
  { key: 'circles', href: '/circles', roles: [] },
  { key: 'members', href: '/members', roles: ['ops', 'finance', 'legal', 'viewer'] },
  { key: 'payments', href: '/payments', roles: ['ops', 'finance', 'viewer'] },
  { key: 'legal', href: '/legal', roles: ['legal', 'finance', 'viewer'] },
  { key: 'finance', href: '/finance', roles: ['finance', 'viewer'] },
  { key: 'config', href: '/config', roles: [] },
  { key: 'content', href: '/content', roles: ['ops', 'legal', 'viewer'] },
  { key: 'support', href: '/support', roles: ['ops', 'viewer'] },
  { key: 'monitoring', href: '/monitoring', roles: ['ops', 'finance', 'viewer'] },
  { key: 'audit', href: '/audit', roles: [] },
];

const SUPER_ONLY: NavKey[] = ['audit'];

export function canSee(roles: readonly AdminRole[], key: NavKey): boolean {
  if (roles.includes('super_admin')) return true;
  if (SUPER_ONLY.includes(key)) return false;
  const item = NAV.find((n) => n.key === key);
  return !!item && (item.roles.length === 0 || item.roles.some((r) => roles.includes(r)));
}

export function visibleNav(roles: readonly AdminRole[]) {
  return NAV.filter((n) => canSee(roles, n.key));
}

/** Can this admin perform an action needing one of `allowed` (super_admin always can)? */
export function can(roles: readonly AdminRole[], ...allowed: AdminRole[]): boolean {
  return roles.includes('super_admin') || allowed.some((r) => roles.includes(r));
}
