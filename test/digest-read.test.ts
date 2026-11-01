import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('reads 5 jobs, sorted by job, and counts the 1 bad line', () => {
    expect(night).not.toBeNull();
    expect(night!.night).toBe('2026-10-28');
    expect(night!.badLines).toBe(1);
    expect(night!.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('aggregates a job with retries', () => {
    const row = night!.rows.find((r) => r.job === 'fixtures/refresh');
    expect(row).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      first: '2026-10-29T01:30:00+01:00',
      last: '2026-10-29T01:37:00+01:00',
    });
  });

  it('keeps the offset in first/last and the last error seen', () => {
    const row = night!.rows.find((r) => r.job === 'lane/sync');
    expect(row).toMatchObject({
      runs: 8,
      retries: 1,
      lastStatus: 'ok',
      lastError: 'lock held',
      first: '2026-10-28T23:00:06+01:00',
      last: '2026-10-29T05:00:04+01:00',
    });
  });

  it('keeps a fail and its error', () => {
    const row = night!.rows.find((r) => r.job === 'notes/backup');
    expect(row).toMatchObject({ owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('keeps a row whose owner is null', () => {
    const row = night!.rows.find((r) => r.job === 'digest/render');
    expect(row).toMatchObject({ owner: null, runs: 1, lastStatus: 'ok', lastError: null });
  });
});

describe('readNight on a temp runs dir', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when the night has no file', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
  });

  it('reads an empty file as nothing ran, not null', () => {
    writeFileSync(join(dir, '2026-01-01.jsonl'), '');
    expect(readNight(dir, '2026-01-01')).toEqual({ night: '2026-01-01', rows: [], badLines: 0 });
  });

  it('keeps owner null', () => {
    writeFileSync(join(dir, '2026-01-01.jsonl'), '{"at":"2026-01-01T05:00:00+01:00","job":"a","status":"ok","owner":null}\n');
    expect(readNight(dir, '2026-01-01')!.rows).toEqual([
      { job: 'a', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null, first: '2026-01-01T05:00:00+01:00', last: '2026-01-01T05:00:00+01:00' },
    ]);
  });

  it('skips blank lines and counts every malformed line as bad', () => {
    const ok = '{"at":"t","job":"a","status":"ok","owner":"x"}';
    const lines = [
      '',
      ok,
      '   ',
      '42',
      '[]',
      'null',
      '{"at":"t","job":"a","status":"done","owner":"x"}', // unknown status
      '{"at":"t","job":"a","status":"ok"}', // owner missing
      '{"at":"t","job":"a","status":"ok","owner":7}', // owner not string/null
      '{"at":1,"job":"a","status":"ok","owner":"x"}', // at not string
      '{"at":"t","job":"a","status":"fail","owner":"x","error":5}', // error not string
      '{"at":"t","job":"a"', // truncated
      ok + '\r',
    ];
    writeFileSync(join(dir, '2026-01-01.jsonl'), lines.join('\n') + '\n');
    const n = readNight(dir, '2026-01-01')!;
    expect(n.badLines).toBe(9);
    expect(n.rows).toHaveLength(1);
    expect(n.rows[0]).toMatchObject({ job: 'a', runs: 2 });
  });
});
