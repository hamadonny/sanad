/** Streams a KYC document from the API for a signed-in reviewer (the API audits the read). */
import { apiRaw } from '../../../../../lib/server';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; which: string }> }) {
  const { id, which } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id) || !['front', 'back', 'selfie'].includes(which))
    return new Response('not found', { status: 404 });
  const res = await apiRaw(`/admin/kyc/${id}/documents/${which}`);
  return new Response(res.body, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    },
  });
}
