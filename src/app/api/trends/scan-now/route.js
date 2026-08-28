// Manual trigger for the "Run scan now" button in the /trends UI —
// session-gated instead of cron-secret-gated, same underlying
// runTrendScan().

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { runTrendScan } from '@/lib/trends';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session) {
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
        // already emitted as an 'error' event inside runTrendScan
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
