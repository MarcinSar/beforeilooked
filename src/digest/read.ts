import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

type LogLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

const STATUSES: readonly string[] = ['ok', 'retry', 'fail'] satisfies RunStatus[];

// Parse at the edge: anything that is not exactly a log line is null (a bad line).
function parseLine(text: string): LogLine | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== 'string' || typeof o.job !== 'string') return null;
  if (typeof o.status !== 'string' || !STATUSES.includes(o.status)) return null;
  if (!('owner' in o) || (o.owner !== null && typeof o.owner !== 'string')) return null;
  if ('error' in o && typeof o.error !== 'string') return null;
  const line: LogLine = { at: o.at, job: o.job, status: o.status as RunStatus, owner: o.owner };
  if (typeof o.error === 'string') line.error = o.error;
  return line;
}

export const readNight: ReadNight = (runsDir, night) => {
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }

  const byJob = new Map<string, DigestRow>();
  let badLines = 0;

  // File order is the log's order: first/last/lastStatus follow it, `at` strings stay untouched.
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    const line = parseLine(raw);
    if (!line) {
      badLines += 1;
      continue;
    }
    const row = byJob.get(line.job);
    if (!row) {
      byJob.set(line.job, {
        job: line.job,
        owner: line.owner,
        runs: 1,
        retries: line.status === 'retry' ? 1 : 0,
        lastStatus: line.status,
        lastError: line.error ?? null,
        first: line.at,
        last: line.at,
      });
      continue;
    }
    row.owner = line.owner;
    row.runs += 1;
    if (line.status === 'retry') row.retries += 1;
    row.lastStatus = line.status;
    if (line.error !== undefined) row.lastError = line.error;
    row.last = line.at;
  }

  // Sorted here and only here (ADR 0001). Code-point order, not locale: same order everywhere.
  const rows = [...byJob.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { night, rows, badLines };
};
