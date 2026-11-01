import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

// Route tests for #2 (GET /digest/:night) and #3 (GET /api/digest/:night).
// Fixtures live in a temp runs dir this file fills itself; runs/ is never touched.

const NORMAL = '2026-10-28'; // normal night: 5 jobs, unsorted in the file
const EMPTY = '2026-10-29'; // empty file: nothing ran
const BAD = '2026-10-30'; // one line that does not parse
const MISSING = '2026-10-31'; // no file at all

const normalLines = [
  { at: '2026-10-28T23:30:00+01:00', job: 'rig/rotate-logs', status: 'ok', owner: 'rook' },
  { at: '2026-10-28T23:00:00+01:00', job: 'lane/sync', status: 'ok', owner: 'lane-07' },
  { at: '2026-10-28T23:10:00+01:00', job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' },
  { at: '2026-10-28T23:12:00+01:00', job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' },
  { at: '2026-10-28T23:14:00+01:00', job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' },
  { at: '2026-10-28T23:16:00+01:00', job: 'fixtures/refresh', status: 'ok', owner: 'rook' },
  { at: '2026-10-28T23:20:00+01:00', job: 'notes/backup', status: 'fail', owner: 'lane-07', error: 'quota exceeded' },
  { at: '2026-10-28T23:40:00+01:00', job: 'digest/render', status: 'ok', owner: null },
];

const badLines = [
  '{"at":"2026-10-30T23:00:00+01:00","job":"lane/sync","status":"ok","owner":"lane-07"}',
  '{"at":"2026-10-30T23:02:00+01:00","job":"lane/sync","status":"ok"', // truncated, does not parse
  '{"at":"2026-10-30T23:05:00+01:00","job":"digest/render","status":"ok","owner":null}',
];

let runsDir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-route-'));
  writeFileSync(join(runsDir, `${NORMAL}.jsonl`), normalLines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
  writeFileSync(join(runsDir, `${BAD}.jsonl`), badLines.join('\n') + '\n');
  app = createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

// The `<tr>` segment of the page that holds this job's cells (Hono renders cells as `<td>job</td>`).
function rowOf(html: string, job: string): string | undefined {
  return html.split('<tr').find((seg) => seg.includes(`>${job}<`));
}

describe('GET /digest/:night (#2)', () => {
  it('normal night renders 200 with one row per job, sorted, and marks', async () => {
    const res = await app.request(`/digest/${NORMAL}`);
    expect(res.status).toBe(200);
    const html = await res.text();

    const order = ['digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs'].map((j) =>
      html.indexOf(`>${j}<`),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    // retries >= 3 and any fail carry the warn class; the others do not
    expect(rowOf(html, 'fixtures/refresh')).toContain('warn');
    expect(rowOf(html, 'notes/backup')).toContain('warn');
    expect(rowOf(html, 'lane/sync')).not.toContain('warn');
    expect(rowOf(html, 'rig/rotate-logs')).not.toContain('warn');
  });

  it('normal night shows the offset from the log and the last error', async () => {
    const html = await (await app.request(`/digest/${NORMAL}`)).text();
    const refresh = rowOf(html, 'fixtures/refresh')!;
    expect(refresh).toContain('2026-10-28T23:10:00+01:00');
    expect(refresh).toContain('2026-10-28T23:16:00+01:00');
    expect(refresh).toContain('upstream 503');
    expect(rowOf(html, 'notes/backup')).toContain('quota exceeded');
  });

  it('a null owner renders as a dash, not an empty cell', async () => {
    const html = await (await app.request(`/digest/${NORMAL}`)).text();
    const render = rowOf(html, 'digest/render')!;
    expect(render).toContain('—');
    expect(render).not.toContain('<td></td>');
  });

  it('night with no file returns 404', async () => {
    const res = await app.request(`/digest/${MISSING}`);
    expect(res.status).toBe(404);
  });

  it('a night that is not YYYY-MM-DD returns 404', async () => {
    expect((await app.request('/digest/yesterday')).status).toBe(404);
    expect((await app.request('/digest/2026-1-1')).status).toBe(404);
  });

  it('empty night renders 200 and says nothing ran', async () => {
    const res = await app.request(`/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('night with a bad line renders 200 with the good rows still there', async () => {
    const res = await app.request(`/digest/${BAD}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('>lane/sync<');
    expect(html).toContain('>digest/render<');
  });
});

describe('GET /api/digest/:night (#3)', () => {
  it('normal night returns 200 with { night, rows, badLines }, rows sorted by job', async () => {
    const res = await app.request(`/api/digest/${NORMAL}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night: NORMAL,
      badLines: 0,
      rows: [
        {
          job: 'digest/render',
          owner: null,
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          first: '2026-10-28T23:40:00+01:00',
          last: '2026-10-28T23:40:00+01:00',
        },
        {
          job: 'fixtures/refresh',
          owner: 'rook',
          runs: 4,
          retries: 3,
          lastStatus: 'ok',
          lastError: 'upstream 503',
          first: '2026-10-28T23:10:00+01:00',
          last: '2026-10-28T23:16:00+01:00',
        },
        {
          job: 'lane/sync',
          owner: 'lane-07',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          first: '2026-10-28T23:00:00+01:00',
          last: '2026-10-28T23:00:00+01:00',
        },
        {
          job: 'notes/backup',
          owner: 'lane-07',
          runs: 1,
          retries: 0,
          lastStatus: 'fail',
          lastError: 'quota exceeded',
          first: '2026-10-28T23:20:00+01:00',
          last: '2026-10-28T23:20:00+01:00',
        },
        {
          job: 'rig/rotate-logs',
          owner: 'rook',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          first: '2026-10-28T23:30:00+01:00',
          last: '2026-10-28T23:30:00+01:00',
        },
      ],
    });
  });

  it('keeps owner null as null in JSON', async () => {
    const body = (await (await app.request(`/api/digest/${NORMAL}`)).json()) as { rows: { owner: unknown }[] };
    expect(body.rows.find((r) => r.owner === null)).toBeDefined();
    expect(body.rows.some((r) => r.owner === '—')).toBe(false);
  });

  it('night with no file returns 404 with the error body', async () => {
    const res = await app.request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no such night' });
  });

  it('a night that is not YYYY-MM-DD returns 404', async () => {
    expect((await app.request('/api/digest/yesterday')).status).toBe(404);
    expect((await app.request('/api/digest/2026-1-1')).status).toBe(404);
  });

  it('empty night returns 200 with rows []', async () => {
    const res = await app.request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night: EMPTY, rows: [], badLines: 0 });
  });

  it('night with a bad line returns 200, the good rows, and badLines 1', async () => {
    const res = await app.request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { night: string; rows: { job: string }[]; badLines: number };
    expect(body.night).toBe(BAD);
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['digest/render', 'lane/sync']);
  });
});

describe('page and JSON agree', () => {
  it('the page lists the same jobs, in the same order, as the JSON', async () => {
    const html = await (await app.request(`/digest/${NORMAL}`)).text();
    const body = (await (await app.request(`/api/digest/${NORMAL}`)).json()) as { rows: { job: string }[] };
    const positions = body.rows.map((r) => html.indexOf(`>${r.job}<`));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});
