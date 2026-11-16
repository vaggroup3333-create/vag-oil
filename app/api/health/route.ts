import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

// Readiness uses the same worker and D1 connection as business routes. It never
// reads or returns customer records, credentials, balances or product data.
export async function GET() {
  const headers = { 'Cache-Control': 'no-store, max-age=0' };
  try {
    if (!env.DB) throw new Error('Database unavailable');
    await env.DB.prepare('SELECT version FROM ledgers LIMIT 1').first();
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
