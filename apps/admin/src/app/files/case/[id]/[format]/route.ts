/** Legal case file as PDF or ZIP (legal role; the API audits the download). */
import { proxyFile, UUID } from '../../../../../lib/proxy-file';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; format: string }> }) {
  const { id, format } = await ctx.params;
  if (!UUID.test(id) || !['pdf', 'zip'].includes(format))
    return new Response('not found', { status: 404 });
  return proxyFile(`/admin/legal/cases/${id}/file.${format}`, `sanad-case.${format}`);
}
