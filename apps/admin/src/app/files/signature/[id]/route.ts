/** A member's signed contract/addendum PDF (ops, legal; audited by the API). */
import { proxyFile, UUID } from '../../../../lib/proxy-file';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response('not found', { status: 404 });
  return proxyFile(`/admin/signatures/${id}/pdf`, 'sanad-signed.pdf');
}
