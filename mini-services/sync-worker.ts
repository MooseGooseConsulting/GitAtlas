/**
 * GitAtlas sync-worker
 *
 * LEGACY COMPATIBILITY: this worker belongs to the pre-#10 enrichment
 * architecture. It currently keeps invoking the old in-app analysis routes so
 * the dashboard stays live.
 *
 * Target direction (issues #9-#19): retain only the boring repository-change
 * detection / refresh responsibilities that remain useful. Do NOT grow this
 * worker into an agent runtime, tool loop, semantic orchestrator, or subagent
 * framework. New repository/corpus reasoning should be delegated to an
 * existing capable coding/research harness through the thin handoff defined
 * by #10 and the prompts/skills in #11/#13.
 *
 * Current legacy loops:
 *   - refresh:  POST /api/sync/refresh        every SYNC_REFRESH_INTERVAL seconds
 *               (cheap GitHub probe, marks changed repos stale)
 *   - enrich:   POST /api/sync/enrich-next    every SYNC_ENRICH_INTERVAL seconds
 *               (drives the old shallow/deep in-app enrichment path)
 *
 * Both loops are tolerant: any failure is logged and the loop continues.
 * We never want a transient GitHub 502 or LLM hiccup to kill the worker.
 */

const BASE_URL = process.env.SYNC_BASE_URL || 'http://localhost:3000';
const USERNAME = process.env.SYNC_USERNAME || 'Coldaine';
const REFRESH_INTERVAL = Number(process.env.SYNC_REFRESH_INTERVAL || 900); // 15 min
const ENRICH_INTERVAL = Number(process.env.SYNC_ENRICH_INTERVAL || 60); // 1 min

function ts() {
  return new Date().toISOString();
}

async function callJson(path: string, body: unknown) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} :: ${text.slice(0, 300)}`);
  }
  return data;
}

async function refreshOnce() {
  try {
    const data = await callJson('/api/sync/refresh', { username: USERNAME });
    console.log(
      `[${ts()}] refresh ok :: probed=${data.probed} changed=${data.changed} created=${data.created}`,
    );
  } catch (err: any) {
    console.error(`[${ts()}] refresh failed:`, err?.message || err);
  }
}

async function enrichOnce() {
  try {
    const data = await callJson('/api/sync/enrich-next', {
      username: USERNAME,
      baseUrl: BASE_URL,
    });
    if (data.done) {
      // Nothing to do; that's normal. Print quietly.
      console.log(`[${ts()}] enrich idle`);
    } else {
      console.log(`[${ts()}] enrich step=${data.step} project=${data.project || '-'}`);
    }
  } catch (err: any) {
    console.error(`[${ts()}] enrich failed:`, err?.message || err);
  }
}

console.log(`GitAtlas sync-worker starting`);
console.log(`  base=${BASE_URL} user=${USERNAME}`);
console.log(`  refresh every ${REFRESH_INTERVAL}s, enrich every ${ENRICH_INTERVAL}s`);

// Kick both immediately so the operator gets feedback without waiting.
refreshOnce();
enrichOnce();

setInterval(refreshOnce, REFRESH_INTERVAL * 1000);
setInterval(enrichOnce, ENRICH_INTERVAL * 1000);
