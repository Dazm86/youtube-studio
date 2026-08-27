// فیکسِ ۲۰۲۶-۰۸-۲۷ — همون فیکسِ ایمپورتِ scan-now/route.js، برای
// یکدست‌شدن با بقیه‌ی روت‌های این پروژه (next-auth/authOptions).
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { ensureTrendsSchema, updateTrendTopicStatus } from '@/lib/trends/db.js';

export const dynamic = 'force-dynamic';

const ALLOWED_STATUSES = ['approved', 'rejected', 'pending', 'produced'];

export async function PATCH(request, { params }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  await ensureTrendsSchema();
  const { id } = params;
  const body = await request.json().catch(() => ({}));
  const { status } = body;

  if (!ALLOWED_STATUSES.includes(status)) {
    return new Response(JSON.stringify({ error: `status must be one of ${ALLOWED_STATUSES.join(', ')}` }), {
      status: 400,
    });
  }

  const updated = await updateTrendTopicStatus(id, status);
  if (!updated) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  }
  return Response.json({ topic: updated });
}
