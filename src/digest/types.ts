// Plan morning-digest § 1. The contract every part of § 2 builds against.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One row per job in a night's run log.
export type DigestRow = {
  job: string;
  owner: string | null; // the owner on the job's latest line; null renders as "—"
  runs: number; // lines for the job
  retries: number; // lines with status "retry"
  lastStatus: RunStatus; // status of the job's latest line
  lastError: string | null; // most recent `error` seen for the job, null if none
  first: string; // `at` of the job's first line, exactly as in the log (offset kept)
  last: string; // `at` of the job's latest line, exactly as in the log (offset kept)
};

export type NightDigest = {
  night: string;
  rows: DigestRow[]; // sorted by job here and only here; page and JSON never re-sort (ADR 0001)
  badLines: number; // non-blank lines that did not parse; counted, never thrown
};

// null: runs/<night>.jsonl does not exist (404). An empty file is { rows: [], badLines: 0 }.
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
