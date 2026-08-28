import { ensureTrendsSchema, listTrendTopics, getLatestScan } from '@/lib/trends/db';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  await ensureTrendsSchema();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || undefined;
  const minScoreParam = searchParams.get('minScore');
  const minScore = minScoreParam ? Number(minScoreParam) : undefined;
  const limit = Number(searchParams.get('limit') || 50);

  const [topics, latestScan] = await Promise.all([
    listTrendTopics({ status, minScore, limit }),
    getLatestScan(),
  ]);

  return Response.json({ topics, latestScan });
}
