#!/usr/bin/env bash
# Read-only viewer for the phased feature plan in this directory.
# Prints each batch overview, per-phase checkbox progress, and the current phase.
# Touches nothing but stdout — safe to run alongside a working agent.
#
#   bash dev/feature_plans/status.sh          # full status
#   bash dev/feature_plans/status.sh --current  # just the current phase
#   bash dev/feature_plans/status.sh <NN>       # print one phase file (e.g. 09)

set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors only when writing to a terminal.
if [ -t 1 ]; then
  B=$'\e[1m'; DIM=$'\e[2m'; GRN=$'\e[32m'; YEL=$'\e[33m'; CYN=$'\e[36m'; RST=$'\e[0m'
else
  B=''; DIM=''; GRN=''; YEL=''; CYN=''; RST=''
fi

# `NN` argument: dump that phase file and exit.
if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
  pad=$(printf '%02d' "$((10#$1))")
  f=$(ls "$DIR"/"$pad"-*.md "$DIR"/"$((10#$1))"-*.md 2>/dev/null | head -1 || true)
  [ -n "$f" ] && exec cat "$f"
  echo "No phase file matching $pad-*.md" >&2; exit 1
fi

heading() { sed -n 's/^# //p' "$1" | head -1; }        # first "# ..." line, minus the hash
# Drop the redundant "Phase N —"/"Session NN —" prefix and trailing tags.
title_of() { heading "$1" | sed -E 's/^(Phase|Session) [0-9]+ [—-] *//; s/ *\((inert|INVESTIGATION)\)//I'; }

# Returns: DONE | WIP | TODO | NONE  (NONE = no checkboxes, i.e. an overview file)
status_of() {
  local f="$1" ch un
  ch=$(grep -cE '^[[:space:]]*- \[x\]' "$f" || true)
  un=$(grep -cE '^[[:space:]]*- \[ \]' "$f" || true)
  if   [ "$((ch+un))" -eq 0 ]; then echo NONE
  elif [ "$un" -eq 0 ];        then echo DONE
  elif [ "$ch" -eq 0 ];        then echo TODO
  else                              echo WIP
  fi
}
counts_of() {
  local f="$1" ch un
  ch=$(grep -cE '^[[:space:]]*- \[x\]' "$f" || true)
  un=$(grep -cE '^[[:space:]]*- \[ \]' "$f" || true)
  echo "$ch/$((ch+un))"
}

current=""   # first phase file (numeric order) that is WIP, else first TODO
# Match any NN-*.md (1+ leading digits) and sort numerically so 9 < 10 < 100.
files=$(ls "$DIR"/[0-9]*-*.md 2>/dev/null | sort -V)

if [[ "${1:-}" != "--current" ]]; then
  echo "${B}PokeRoguePocket — feature plan status${RST}"
  echo "${DIM}$DIR${RST}"
  echo
fi

# First pass finds the current phase; done up front so --current can short-circuit.
for f in $files; do
  base=$(basename "$f")
  [[ "$base" == *overview* ]] && continue
  st=$(status_of "$f")
  if [ -z "$current" ] && { [ "$st" = WIP ] || [ "$st" = TODO ]; }; then current="$f"; fi
done

if [[ "${1:-}" == "--current" ]]; then
  if [ -n "$current" ]; then
    echo "$(basename "$current" .md) — $(title_of "$current")  [$(counts_of "$current") done]"
  else
    echo "All phases complete."
  fi
  exit 0
fi

for f in $files; do
  base=$(basename "$f"); num=${base%%-*}
  if [[ "$base" == *overview* ]]; then
    echo
    echo "${B}${CYN}▸ $(heading "$f")${RST} ${DIM}($base)${RST}"
    continue
  fi
  st=$(status_of "$f"); cnt=$(counts_of "$f")
  case "$st" in
    DONE) mark="${GRN}✔${RST}" ;;
    WIP)  mark="${YEL}◑${RST}" ;;
    *)    mark="○"             ;;
  esac
  printf '    %b %s  %-46s %s\n' "$mark" "$num" "$(title_of "$f")" "${DIM}$cnt${RST}"
done

echo
if [ -n "$current" ]; then
  echo "${B}${YEL}──▶ CURRENT:${RST} $(basename "$current" .md) — ${B}$(title_of "$current")${RST}  [$(counts_of "$current") done]"
  cnum=$(basename "$current"); cnum=${cnum%%-*}
  echo "${DIM}    view it:  bash $(basename "${BASH_SOURCE[0]}") ${cnum}  |  or open ${current}${RST}"
else
  echo "${B}${GRN}✔ All phases complete.${RST}"
fi
