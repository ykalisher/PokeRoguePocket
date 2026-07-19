#!/usr/bin/env bash
# Owner task board — view your remaining feature tasks and mark them done.
#
# The OWNER's counterpart to dev/feature_plans/status.sh: that one is read-only and
# lists agent-executed phases; this one is the short list of features only the owner
# implements, and it can MUTATE (mark done / add / reopen) from the command line.
#
# Source of truth: tasks.md (one canonical line per task). Completed tasks stay in
# place, flipped to [x] with a done: date — nothing is deleted, so `log` is history.
#
#   bash dev/owner_tasks/tasks.sh                 # open tasks (what's left)
#   bash dev/owner_tasks/tasks.sh list --area X   # open tasks in one area
#   bash dev/owner_tasks/tasks.sh all             # full board (open + done)
#   bash dev/owner_tasks/tasks.sh log             # completed tasks (history)
#   bash dev/owner_tasks/tasks.sh show 5          # one task + its notes
#   bash dev/owner_tasks/tasks.sh done 5          # mark #005 complete   (OWNER only)
#   bash dev/owner_tasks/tasks.sh reopen 5        # un-complete #005     (OWNER only)
#   bash dev/owner_tasks/tasks.sh add "Title" --area X --needs 6   # add a task
#
# Agents: you may run `add` ONLY when the owner explicitly asks. Never `done`/`reopen`.

set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILE="$DIR/tasks.md"

# Colors only when writing to a terminal (same idiom as feature_plans/status.sh).
if [ -t 1 ]; then
  B=$'\e[1m'; DIM=$'\e[2m'; GRN=$'\e[32m'; YEL=$'\e[33m'; CYN=$'\e[36m'; MAG=$'\e[35m'; RED=$'\e[31m'; RST=$'\e[0m'
else
  B=''; DIM=''; GRN=''; YEL=''; CYN=''; MAG=''; RED=''; RST=''
fi

die()  { printf '%s%s%s\n' "$RED" "$*" "$RST" >&2; exit 1; }
warn() { printf '%s%s%s\n' "$YEL" "$*" "$RST" >&2; }

[ -f "$FILE" ] || die "missing task file: $FILE"

today() { date +%F; }

# Strip everything but digits, then zero-pad to a min width of 3 (matches stored IDs;
# printf never truncates, so 4-digit ids survive).
pad_id() {
  local raw="${1//[^0-9]/}"
  [ -n "$raw" ] || die "not a task id: '${1:-}'"
  printf '%03d' "$((10#$raw))"
}

# Normalize a --needs value ("1", "#1", "1,3", "-", "") into "-" or "NNN[,NNN...]".
normalize_needs() {
  local raw="${1:-}" out="" part
  { [ -z "$raw" ] || [ "$raw" = "-" ]; } && { echo "-"; return; }
  local IFS=','
  for part in $raw; do
    part="${part//[^0-9]/}"
    [ -n "$part" ] || continue
    out="${out:+$out,}$(printf '%03d' "$((10#$part))")"
  done
  echo "${out:--}"
}

# Emit one TSV row per task line: box(open|done) id area added done needs title.
# Portable awk only (no gensub / match-captures): split meta on ' :: ', tokenize the rest.
parse_tasks() {
  awk '
    /^- \[[ x]\] #[0-9]+/ {
      box = (substr($0, 4, 1) == "x") ? "done" : "open"
      ti = index($0, " :: ")
      if (ti > 0) { meta = substr($0, 1, ti - 1); title = substr($0, ti + 4) }
      else        { meta = $0; title = "" }
      id = ""; area = "-"; added = "-"; donev = "-"; needs = "-"
      n = split(meta, tok, /[ \t]+/)
      for (i = 1; i <= n; i++) {
        t = tok[i]
        if      (t ~ /^#[0-9]+$/) id    = substr(t, 2)
        else if (t ~ /^area:/)    area  = substr(t, 6)
        else if (t ~ /^added:/)   added = substr(t, 7)
        else if (t ~ /^done:/)    donev = substr(t, 6)
        else if (t ~ /^needs:/)   needs = substr(t, 7)
      }
      printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n", box, id, area, added, donev, needs, title
    }
  ' "$FILE"
}

get_row() { printf '%s\n' "$tsv" | awk -F'\t' -v id="$1" '$2 == id { print; exit }'; }

count_of() { printf '%s\n' "$tsv" | awk -F'\t' -v b="$1" '$1 == b { n++ } END { print n + 0 }'; }

# Space-delimited set of completed ids, e.g. " 001 004 " — for blocked-dep lookups.
done_set() { printf '%s\n' "$tsv" | awk -F'\t' '$1 == "done" { printf " %s", $2 } END { print " " }'; }

# First unmet dependency of a task (an id in needs: that isn't done yet), or "".
first_unmet() {
  local needs="$1" set="$2" d
  { [ "$needs" = "-" ] || [ -z "$needs" ]; } && return 0
  local IFS=','
  for d in $needs; do
    case "$set" in *" $d "*) : ;; *) echo "$d"; return 0 ;; esac
  done
}

# Render one task as a colored line. Args: box id area needs title donev.
fmt_line() {
  local box="$1" id="$2" area="$3" needs="$4" title="$5" donev="$6"
  local mark tag="" suffix=""
  [ "$area" != "-" ] && [ -n "$area" ] && tag="${DIM}[$area]${RST} "
  if [ "$box" = done ]; then
    mark="${GRN}✔${RST}"
    [ "$donev" != "-" ] && suffix="  ${DIM}(done $donev)${RST}"
  else
    local unmet; unmet="$(first_unmet "$needs" "$DONESET")"
    if [ -n "$unmet" ]; then
      mark="${YEL}⊘${RST}"; suffix="  ${YEL}blocked by #$unmet${RST}"
    else
      mark="${CYN}○${RST}"
    fi
  fi
  printf '  %b %s#%s%b  %b%s%b\n' "$mark" "$B" "$id" "$RST" "$tag" "$title" "$suffix"
}

footer() {
  printf '\n%s%s open%s · %s%s done%s\n' \
    "$B" "$(count_of open)" "$RST" "$DIM" "$(count_of done)" "$RST"
}

cmd_list() {   # open tasks only, optional --area filter
  local filter=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --area) filter="${2:-}"; shift 2 ;;
      --area=*) filter="${1#*=}"; shift ;;
      *) die "list: unexpected argument '$1' (try: tasks.sh help)" ;;
    esac
  done
  printf '%sOwner task board — open%s%s\n' "$B" "${filter:+ · area:$filter}" "$RST"
  local shown=0
  while IFS=$'\t' read -r box id area added donev needs title; do
    [ -n "$id" ] || continue
    [ "$box" = open ] || continue
    [ -n "$filter" ] && [ "$area" != "$filter" ] && continue
    fmt_line "$box" "$id" "$area" "$needs" "$title" "$donev"
    shown=$((shown + 1))
  done <<< "$tsv"
  [ "$shown" -eq 0 ] && printf '  %s(nothing open%s)%s\n' "$DIM" "${filter:+ in area:$filter}" "$RST"
  footer
  printf '%s  log: tasks.sh log   ·   full board: tasks.sh all   ·   detail: tasks.sh show <id>%s\n' "$DIM" "$RST"
}

cmd_all() {    # everything, numeric order, marked
  printf '%sOwner task board — all%s\n' "$B" "$RST"
  printf '%s\n' "$tsv" | sort -t$'\t' -k2,2n | while IFS=$'\t' read -r box id area added donev needs title; do
    [ -n "$id" ] || continue
    fmt_line "$box" "$id" "$area" "$needs" "$title" "$donev"
  done
  footer
}

cmd_log() {    # completed tasks (history), numeric order
  printf '%sOwner task board — completed%s\n' "$B" "$RST"
  local n; n="$(count_of done)"
  if [ "$n" -eq 0 ]; then
    printf '  %s(no completed tasks yet)%s\n' "$DIM" "$RST"
    return
  fi
  printf '%s\n' "$tsv" | awk -F'\t' '$1 == "done"' | sort -t$'\t' -k2,2n \
    | while IFS=$'\t' read -r box id area added donev needs title; do
        fmt_line "$box" "$id" "$area" "$needs" "$title" "$donev"
      done
}

cmd_show() {   # one task's line + its indented "> " notes
  [ $# -ge 1 ] || die "show: need a task id — tasks.sh show <id>"
  local id; id="$(pad_id "$1")"
  local row; row="$(get_row "$id")"
  [ -n "$row" ] || die "no task #$id"
  IFS=$'\t' read -r box _id area added donev needs title <<< "$row"
  fmt_line "$box" "$id" "$area" "$needs" "$title" "$donev"
  printf '    %sadded %s' "$DIM" "$added"
  [ "$donev" != "-" ] && printf ' · done %s' "$donev"
  [ "$needs" != "-" ] && printf ' · needs #%s' "$needs"
  printf '%s\n' "$RST"
  # Notes: indented "> " lines below the task line, until the next task line.
  awk -v id="$id" '
    $0 ~ ("^- \\[[ x]\\] #" id " ") { show = 1; next }
    show && /^- \[[ x]\] #[0-9]+/  { show = 0 }
    show && /^[[:space:]]*>/       { sub(/^[[:space:]]*> ?/, ""); print "    " $0 }
  ' "$FILE"
}

cmd_done() {   # OWNER only — mark a task complete
  [ $# -ge 1 ] || die "done: need a task id — tasks.sh done <id>"
  local id; id="$(pad_id "$1")"
  local row; row="$(get_row "$id")"
  [ -n "$row" ] || die "no task #$id"
  local box needs; box="$(printf '%s' "$row" | cut -f1)"; needs="$(printf '%s' "$row" | cut -f6)"
  [ "$box" = open ] || die "#$id is already done"
  local unmet; unmet="$(first_unmet "$needs" "$(done_set)")"
  [ -n "$unmet" ] && warn "note: #$id depends on #$unmet, which isn't done yet — marking it done anyway."
  local t; t="$(today)"
  local tmp; tmp="$(mktemp)"
  awk -v id="$id" -v today="$t" '
    !d && $0 ~ ("^- \\[ \\] #" id " ") {
      sub(/^- \[ \]/, "- [x]")
      if (match($0, /added:[0-9][0-9-]*/)) sub(/added:[0-9][0-9-]*/, "& done:" today)
      else                                 sub(/ :: /, " done:" today " :: ")
      d = 1
    }
    { print }
  ' "$FILE" > "$tmp" && mv "$tmp" "$FILE" || { rm -f "$tmp"; die "failed to update $FILE"; }
  printf '%s✔ marked done:%s #%s  (%s)\n' "$GRN" "$RST" "$id" "$t"
}

cmd_reopen() { # OWNER only — undo a completion
  [ $# -ge 1 ] || die "reopen: need a task id — tasks.sh reopen <id>"
  local id; id="$(pad_id "$1")"
  local row; row="$(get_row "$id")"
  [ -n "$row" ] || die "no task #$id"
  local box; box="$(printf '%s' "$row" | cut -f1)"
  [ "$box" = done ] || die "#$id is not marked done"
  local tmp; tmp="$(mktemp)"
  awk -v id="$id" '
    !d && $0 ~ ("^- \\[x\\] #" id " ") {
      sub(/^- \[x\]/, "- [ ]")
      sub(/ done:[0-9][0-9-]*/, "")
      d = 1
    }
    { print }
  ' "$FILE" > "$tmp" && mv "$tmp" "$FILE" || { rm -f "$tmp"; die "failed to update $FILE"; }
  printf '%s○ reopened:%s #%s\n' "$CYN" "$RST" "$id"
}

cmd_add() {    # append a new task; agents run this ONLY when the owner asks
  local title="" area="" needs=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --area)   area="${2:-}"; shift 2 ;;
      --area=*) area="${1#*=}"; shift ;;
      --needs)  needs="${2:-}"; shift 2 ;;
      --needs=*) needs="${1#*=}"; shift ;;
      --*) die "add: unknown flag '$1'" ;;
      *) if [ -z "$title" ]; then title="$1"; shift; else die "add: unexpected argument '$1' (quote the title)"; fi ;;
    esac
  done
  [ -n "$title" ] || die 'add: title required — tasks.sh add "<title>" [--area X] [--needs NNN]'
  case "$title" in *" :: "*) die "add: title may not contain ' :: '";; esac
  needs="$(normalize_needs "$needs")"
  area="${area//[^A-Za-z0-9_-]/}"   # keep area a single clean token
  local max next
  max="$(grep -oE '#[0-9]+' "$FILE" | tr -d '#' | sort -n | tail -1 || true)"
  [ -n "$max" ] || max=0
  next="$(printf '%03d' "$((10#$max + 1))")"
  local meta="#$next"
  [ -n "$area" ] && meta="$meta area:$area"
  meta="$meta added:$(today) needs:$needs"
  printf -- '- [ ] %s :: %s\n' "$meta" "$title" >> "$FILE"
  printf '%s+ added:%s #%s  %s\n' "$GRN" "$RST" "$next" "$title"
}

usage() {
  cat <<EOF
${B}Owner task board${RST} — view your remaining tasks and mark them done.
Source: $FILE

  ${B}tasks.sh${RST}                       open tasks (default)
  ${B}tasks.sh list${RST} [--area X]       open tasks, optionally one area
  ${B}tasks.sh all${RST}                   full board (open + done)
  ${B}tasks.sh log${RST}                   completed tasks (history)
  ${B}tasks.sh show${RST} <id>             one task with its notes
  ${B}tasks.sh done${RST} <id>             mark complete            ${DIM}(owner only)${RST}
  ${B}tasks.sh reopen${RST} <id>           undo a completion        ${DIM}(owner only)${RST}
  ${B}tasks.sh add${RST} "<title>" [--area X] [--needs NNN]   add a task

Marks: ${CYN}○${RST} open  ${YEL}⊘${RST} blocked (dependency not done)  ${GRN}✔${RST} done
Ids accept any form: 5, 05, 005, #5.
EOF
}

# ── dispatch ────────────────────────────────────────────────────────────────
cmd="${1:-list}"
[ $# -gt 0 ] && shift
tsv="$(parse_tasks)"
DONESET="$(done_set)"

case "$cmd" in
  list|ls)          cmd_list "$@" ;;
  all|board)        cmd_all ;;
  log|history)      cmd_log ;;
  show)             cmd_show "$@" ;;
  done|complete)    cmd_done "$@" ;;
  reopen|undo)      cmd_reopen "$@" ;;
  add)              cmd_add "$@" ;;
  help|-h|--help)   usage ;;
  *)                die "unknown command: '$cmd' (try: tasks.sh help)" ;;
esac
