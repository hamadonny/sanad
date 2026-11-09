/** CSV downloads (finance). The API builds the file; we pass it through with the admin's token. */
import { apiRaw } from '../../../../lib/server';

export async function GET(_req: Request, ctx: { params: Promise<{ dataset: string }> }) {
  const { dataset } = await ctx.params;
  if (!['ledger', 'accounts', 'revenue'].includes(dataset))
    return new Response('not found', { status: 404 });
  const res = await apiRaw(`/admin/export/${dataset}`);
  return new Response(res.body, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'text/csv',
      'Content-Disposition':
        res.headers.get('content-disposition') ?? `attachment; filename="sanad-${dataset}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
