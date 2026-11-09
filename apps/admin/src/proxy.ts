/**
 * Runs before every page request: keeps the admin session fresh and sends signed-out visitors
 * to /login. Refreshing here (not in pages) is what lets us rotate httpOnly cookies safely.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { refreshOnce } from './lib/refresh';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
  cookieOptions,
  needsRefresh,
} from './lib/session';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Sign-in and the public store pages (privacy, terms, account deletion, support).
  if (pathname === '/login' || pathname.startsWith('/p/')) return NextResponse.next();

  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  const toLogin = () => {
    const res = NextResponse.redirect(new URL('/login', request.url));
    res.cookies.delete(ACCESS_COOKIE);
    res.cookies.delete(REFRESH_COOKIE);
    return res;
  };
  if (!refresh) return toLogin();
  if (!needsRefresh(access)) return NextResponse.next();

  const pair = await refreshOnce(refresh);
  if (!pair) return toLogin();
  // Make the new tokens visible to this request's server components…
  request.cookies.set(ACCESS_COOKIE, pair.accessToken);
  request.cookies.set(REFRESH_COOKIE, pair.refreshToken);
  const res = NextResponse.next({ request: { headers: request.headers } });
  // …and store them in the browser.
  res.cookies.set(ACCESS_COOKIE, pair.accessToken, cookieOptions(pair.expiresIn));
  res.cookies.set(REFRESH_COOKIE, pair.refreshToken, cookieOptions(REFRESH_MAX_AGE));
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
