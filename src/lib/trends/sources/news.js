// Google News RSS is public and needs no API key. The feed is simple
// enough RSS that a tiny hand-rolled extractor avoids pulling in an XML
// parser dependency just for two fields per item.

function decodeXmlEntities(str) {
  return str
    .replace('<![CDATA[', '')
    .replace(']]>', '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Recent news headlines for a keyword (last 14 days) — used as a
 * freshness/relevance signal and as a light extra candidate source.
 */
export async function fetchNewsForKeyword(
  keyword,
  { hl = 'en-US', gl = 'US', ceid = 'US:en', withinDays = 14 } = {}
) {
  try {
    const q = `${keyword} when:${withinDays}d`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = [];
    const blocks = xml.split('<item>').slice(1);
    for (const block of blocks) {
      const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
      const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      if (!titleMatch) continue;
      items.push({
        title: decodeXmlEntities(titleMatch[1]),
        pubDate: pubDateMatch ? pubDateMatch[1] : null,
      });
    }
    return items;
  } catch (err) {
    console.warn(`[trends:news] fetchNewsForKeyword("${keyword}") failed:`, err.message);
    return [];
  }
}
