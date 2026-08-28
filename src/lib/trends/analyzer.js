// AI Analyzer stage: turns each candidate's *measured* signals (already
// computed in scoring.js from real Trends/YouTube/News data) into the two
// judgment-call scores a time series can't answer — shortsFit/longFit —
// plus a clean topic name, a specific angle, and a short reasoning note.
//
// Candidates are sent in small batches (default 5) so one malformed AI
// response only costs a partial re-fallback, not the whole scan — same
// "never let one flaky call break the whole run" philosophy as the rest
// of this app's provider system.

import { generateText } from '../providers/router.js';
import { mapWithConcurrency } from './utils.js';
// ^ NOTE — the one guessed integration point in this whole feature.
// router.js wasn't shared in this session, so this import path and the
// call shape in callTextAI() below are a best-effort match to the
// documented `generateText` export. If your actual signature differs
// (e.g. it takes a plain string instead of an options object, or returns
// a wrapped object instead of a bare string), callTextAI() is the only
// place that needs adjusting — everything else in this file works with
// whatever string it gets back.

const BATCH_SIZE = Number(process.env.TREND_AI_BATCH_SIZE || 5);
// Kept low and separate from the general fetch concurrency — concurrent
// bursts against an AI provider are more likely to trip rate limits than
// concurrent bursts against Trends/YouTube/Reddit/News.
const AI_CONCURRENCY = Number(process.env.TREND_AI_CONCURRENCY || 2);

async function callTextAI(prompt) {
  const result = await generateText({
    prompt,
    system:
      'You are a precise YouTube content strategist. Always reply with ONLY a valid JSON array, no prose before or after it.',
    maxTokens: 1400,
    temperature: 0.4,
  });
  return typeof result === 'string' ? result : result?.text || result?.content || result?.message || '';
}

function clampScore(n, max) {
  const num = Number(n);
  if (!Number.isFinite(num)) return Math.round(max * 0.5);
  return Math.max(0, Math.min(max, Math.round(num)));
}

function heuristicFormatFit(topic) {
  // Crude no-AI fallback, same spirit as suggest-metadata's
  // heuristic (no-Groq-key) path mentioned in ROADMAP.md.
  const wordCount = (topic || '').trim().split(/\s+/).filter(Boolean).length;
  const shortsFit = wordCount > 0 && wordCount <= 6 ? 8 : 5;
  const longFit = wordCount >= 3 ? 7 : 5;
  return { shortsFit, longFit };
}

function summarizeCandidateForPrompt(c, i) {
  const trendsHint = c.signals?.trendsRelated?.length
    ? `rising/related search interest near seed "${c.seed || 'n/a'}"`
    : 'no direct Trends match (found via news/reddit)';
  const redditHint = c.signals?.reddit?.length
    ? `${c.signals.reddit.length} matching Reddit discussion(s), top score ${Math.max(
        ...c.signals.reddit.map((r) => r.score || 0)
      )}`
    : 'no matching Reddit activity';
  const newsHint = c.signals?.news?.length
    ? `${c.signals.news.length} news article(s) in the last 14 days`
    : 'no recent news coverage';
  return [
    `[${i}] topic: "${c.topic}"`,
    `  measured search growth score: ${c.scoreSearchGrowth}/25`,
    `  measured YouTube view-growth score: ${c.scoreViewGrowth}/25`,
    `  measured freshness score: ${c.scoreFreshness}/15 (higher = rose more recently)`,
    `  measured competition score: ${c.scoreCompetition}/15 (higher = LESS existing YouTube supply, i.e. more room for a new channel)`,
    `  context: ${trendsHint}; ${redditHint}; ${newsHint}`,
  ].join('\n');
}

function buildAnalyzerPrompt(batch) {
  return `You are helping "The Mindful Path" — a BRAND NEW mindfulness/
personal-growth YouTube channel with no subscriber base or authority yet,
hosted by an animated presenter named Maya — decide which of the topics
below are worth producing videos about.

For each topic you are given REAL measured signals (not your own guesses):
search-interest growth, YouTube view-growth, freshness (how recently
interest started rising), and competition (higher = LESS existing supply).

IMPORTANT STRATEGY: this channel is new. Do NOT favor a topic just because
it's broadly popular — a huge, saturated topic is a BAD fit right now, no
matter how many people search for it, because a new channel can't compete
for it. Favor topics that are clearly rising (check freshness/growth) but
where competition is still high (meaning: NOT yet crowded). A smaller,
rising, low-competition topic is MORE valuable here than a huge, saturated
one. Let this shape your reasoning and your format-fit scores.

Topics:
${batch.map((c, i) => summarizeCandidateForPrompt(c, i)).join('\n\n')}

Reply with ONLY a JSON array, one object per topic, SAME ORDER as above:
[
  {
    "topic": "clean specific topic name",
    "angle": "one-sentence specific take/hook this channel could use",
    "shortsFit": 0-10,
    "longFit": 0-10,
    "suggestedFormat": "short" | "long" | "both",
    "reasoning": "1-2 sentences, referencing the growth/competition signals"
  }
]`;
}

async function analyzeBatch(batch) {
  try {
    const raw = await callTextAI(buildAnalyzerPrompt(batch));
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('AI response did not contain a JSON array');
    const parsed = JSON.parse(jsonMatch[0]);
    return batch.map((c, i) => {
      const ai = parsed[i] || {};
      return {
        ...c,
        finalTopic: ai.topic || c.topic,
        angle: ai.angle || '',
        reasoning: ai.reasoning || '',
        scoreShortsFit: clampScore(ai.shortsFit, 10),
        scoreLongFit: clampScore(ai.longFit, 10),
        suggestedFormat: ['short', 'long', 'both'].includes(ai.suggestedFormat)
          ? ai.suggestedFormat
          : 'both',
      };
    });
  } catch (err) {
    console.warn('[trends:analyzer] AI batch failed, using heuristic fallback:', err.message);
    return batch.map((c) => {
      const fit = heuristicFormatFit(c.topic);
      return {
        ...c,
        finalTopic: c.topic,
        angle: '',
        reasoning: 'Heuristic fallback used — AI analyzer was unavailable for this topic.',
        scoreShortsFit: fit.shortsFit,
        scoreLongFit: fit.longFit,
        suggestedFormat: 'both',
      };
    });
  }
}

/**
 * Runs the AI analyzer over all scored candidates, batched.
 * @param {Array} candidates - each already carrying scoreSearchGrowth,
 *   scoreViewGrowth, scoreFreshness, scoreCompetition from scoring.js
 */
export async function analyzeTopics(candidates, { emit = () => {} } = {}) {
  const batches = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    batches.push(candidates.slice(i, i + BATCH_SIZE));
  }
  let completed = 0;
  const batchResults = await mapWithConcurrency(batches, AI_CONCURRENCY, async (batch) => {
    const analyzed = await analyzeBatch(batch);
    completed += batch.length;
    emit({ stage: 'ai_analyzer', status: 'running', progress: `${completed}/${candidates.length}` });
    return analyzed;
  });
  return batchResults.flat();
}
