// Isolated orchestration test for lib/autoProduce.js — mocks its direct
// dependencies (generateScript, generateMetadata, runPipeline, and the
// trends db functions) to verify the wiring itself: topic-selection
// priority (topicId > typed topic > auto-pick best approved > AI free
// choice), that runPipeline gets called with the right fields, and that
// a trend topic only gets marked 'produced' when one was actually used.
//
// This does NOT exercise the real script/metadata/pipeline modules
// (those are this project's own, already-working code) — it exercises
// the NEW glue code in autoProduce.js that calls them.
//
// Not runnable standalone (needs the mocked sibling modules this test
// was developed against) — kept here as a record of what was verified
// and a template if you want to re-run it: copy autoProduce.js plus fake
// script/index.js, metadata/index.js, pipeline.js, trends/db.js into an
// isolated folder (see the test bodies below for the exact mock shapes
// used), or adapt into your test runner of choice once you have one.
import assert from 'node:assert/strict';
import { autoProduceVideo, prepareAutoProduceScript } from './src/lib/autoProduce.js';
import { calls as scriptCalls } from './src/lib/script/index.js';
import { pipelineCalls } from './src/lib/pipeline.js';
import { marked } from './src/lib/trends/db.js';

// --- Test 1: explicit topicId wins over everything ---
{
  const r = await prepareAutoProduceScript({ mode: 'long', topicId: 1, topic: 'ignored text', accessToken: 'tok' }, {});
  assert.equal(r.trendTopicRow.id, 1, 'explicit topicId should be used');
  assert.equal(r.script, 'SCRIPT for "Topic From Specific ID" mode=long');
}

// --- Test 2: no topicId, no topic string -> auto-picks best approved trend topic ---
{
  const r = await prepareAutoProduceScript({ mode: 'short', accessToken: 'tok' }, {});
  assert.ok(r.trendTopicRow, 'should auto-pick an approved trend topic');
  assert.equal(r.trendTopicRow.id, 2);
}

// --- Test 3: plain topic string (studio field) takes priority over auto-pick, no trendTopicRow ---
{
  const r = await prepareAutoProduceScript({ mode: 'long', topic: 'My Own Topic', accessToken: 'tok' }, {});
  assert.equal(r.trendTopicRow, null, 'a manually-typed topic should NOT attach to a trend row');
  assert.ok(r.script.includes('My Own Topic'));
}

// --- Test 4: full autoProduceVideo run with a specific topicId marks it produced ---
{
  const events = [];
  const result = await autoProduceVideo(
    { mode: 'long', topicId: 1, accessToken: 'tok', getUploadAccessToken: async () => 'tok2' },
    { emit: (e) => events.push(e) }
  );
  assert.equal(result.trendTopicId, 1);
  assert.ok(result.videoId.startsWith('vid_'));
  assert.equal(result.title, 'Title A');
  assert.equal(result.tags, 'tag1, tag2');
  assert.ok(result.script.includes('Topic From Specific ID'));
  assert.deepEqual(marked[marked.length - 1], { id: 1, videoId: result.videoId }, 'should mark the specific trend topic as produced');
  assert.ok(events.some(e => e.status && e.status.includes('سناریو نوشته شد')), 'should emit script-done progress event');
  const lastPipelineCall = pipelineCalls[pipelineCalls.length - 1];
  assert.equal(lastPipelineCall.title, 'Title A');
  assert.equal(lastPipelineCall.videoMode, 'long');
  assert.equal(lastPipelineCall.tags, 'tag1, tag2');
}

// --- Test 5: no trend topic involved (free topic string) -> nothing marked produced for it ---
{
  const beforeCount = marked.length;
  const result = await autoProduceVideo(
    { mode: 'short', topic: 'Something typed by hand', accessToken: 'tok', getUploadAccessToken: async () => 'tok2' },
    {}
  );
  assert.equal(result.trendTopicId, null);
  assert.equal(marked.length, beforeCount, 'no trend topic should be marked produced when none was used');
}

console.log('All autoProduce.js orchestration tests passed.');
