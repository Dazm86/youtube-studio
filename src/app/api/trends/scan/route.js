// Cron-secret gated, same pattern as api/scheduler/run/route.js — an
// external trigger (here: a new GitHub Actions scheduled workflow, see
// .github/workflows/trend-scan.yml) hits this every 6 hours with
// ?secret=CRON_SECRET. Streams NDJSON progress like generate-and-upload
// does, so the connection stays alive with periodic bytes rather than
// sitting idle through however long the scan takes.

import { runTrendScan } from '@/lib/trends';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  if (!process.env.CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'CRON_SECRET not configured' }), { status: 500 });
  }
  if (secret !== process.env.CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };
      try {
        await runTrendScan({ emit });
      } catch (err) {
        // runTrendScan already emits an 'error' event before rethrowing;
        // nothing further to send here, just close out.
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
    },
  });
}
