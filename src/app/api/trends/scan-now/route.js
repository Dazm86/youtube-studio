// Manual trigger for the "Run scan now" button in the /trends UI —
// session-gated instead of cron-secret-gated, same underlying
// runTrendScan(). If your NextAuth session-check import differs from the
// one below (this project's auth/authOptions.js wasn't shared in this
// session), adjust just the two marked lines.

import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/authOptions.js'; // ADJUST if your path differs
import { runTrendScan } from '@/lib/trends/index.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  const session = await getServerSession(authOptions); // ADJUST if your session-check differs
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
