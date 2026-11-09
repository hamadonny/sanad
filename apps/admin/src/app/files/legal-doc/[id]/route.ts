/** An uploaded legal document (lawyer's contract, Shariah review). */
import { proxyFile, UUID } from '../../../../lib/proxy-file';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response('not found', { status: 404 });
  return proxyFile(`/admin/legal-docs/${id}/file`, 'sanad-legal-document');
}
