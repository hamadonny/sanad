import 'server-only';
import { apiRaw } from './server';

/** Pass a file download from the API through to the browser with the admin's session. */
export async function proxyFile(path: string, fallbackName: string): Promise<Response> {
  const res = await apiRaw(path);
  if (res.status === 401) return Response.redirect('/login', 302);
  return new Response(res.body, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition':
        res.headers.get('content-disposition') ?? `attachment; filename="${fallbackName}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export const UUID = /^[0-9a-f-]{36}$/;
