#!/usr/bin/env bash
# Plan morning-digest § 3: run rig and save one page as a single HTML file (ADR 0001, 0003).
# Output goes to var/ (git-ignored): previews never go into the repo.
# Usage: scripts/save-preview.sh [night]   (default 2026-10-28)
set -euo pipefail

NIGHT="${1:-2026-10-28}"
PORT="${PREVIEW_PORT:-8799}"
OUT="var/preview/index.html"

health() { curl -sf "http://localhost:$PORT/health" >/dev/null; }

# A rig left running on this port would answer instead of ours, with its own marker.
if health; then
  echo "port $PORT already answers /health; stop that rig first" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
# Own process group, so the whole tree (pnpm, tsx, node) stops together.
PORT="$PORT" setsid pnpm exec tsx --env-file-if-exists=.env src/server.ts >/dev/null 2>&1 &
PGID=$!
stop() {
  kill -- "-$PGID" 2>/dev/null || true
  for _ in $(seq 50); do health || return 0; sleep 0.1; done
  echo "rig on port $PORT did not stop" >&2
}
trap stop EXIT

for _ in $(seq 50); do
  health && break
  sleep 0.2
done

curl -sf "http://localhost:$PORT/digest/$NIGHT" -o "$OUT"

# When LANE_MARKER is given (CI passes the secret, empty once it is deleted), the banner must
# show exactly that: the marker, or "no marker set". Never print the marker itself.
if [ -n "${LANE_MARKER+set}" ]; then
  if [ -z "$LANE_MARKER" ]; then
    grep -q '<span class="marker">no marker set</span>' "$OUT" || { echo "banner is not 'no marker set'" >&2; exit 1; }
  else
    grep -qF "<span class=\"marker\">$LANE_MARKER</span>" "$OUT" || { echo "banner does not carry LANE_MARKER" >&2; exit 1; }
  fi
fi

echo "saved /digest/$NIGHT -> $OUT ($(wc -c <"$OUT") bytes)"
