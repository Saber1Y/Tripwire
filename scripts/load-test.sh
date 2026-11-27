#!/usr/bin/env bash
# Live Tripwire runs on Unichain Sepolia + Lasna, driven by contracts/script/demo/TripwireDemo.s.sol and checked
# against the indexer after every step.
#
#   scripts/load-test.sh edge        three live edge cases: bounce-back, slippage refusal, cancel during flight
#   scripts/load-test.sh load [N]    N clean full loops (default 50), then the latency summary
#
# Needs: the indexer running on INDEXER_URL, the `tripwire-deployer` Foundry keystore, and DEPLOYER set to its address.
# The keystore password is asked once and kept in a private temp file that is deleted on exit.
set -euo pipefail

MODE="${1:-}"
N="${2:-50}"
DEPLOYER="${DEPLOYER:-0x3f5b96a494061f7338da529e3047809ac6a7fb84}"
INDEXER_URL="${INDEXER_URL:-http://localhost:8787}"
RPC="${UNICHAIN_SEPOLIA_RPC:-https://sepolia.unichain.org}"
WAIT_SECONDS="${WAIT_SECONDS:-90}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/docs/load-test-$(date +%Y%m%d-%H%M%S)-$MODE.log"

if [[ "$MODE" != "edge" && "$MODE" != "load" ]]; then
  echo "usage: $0 edge | load [N]" >&2
  exit 2
fi
curl -sf "$INDEXER_URL/api/health" >/dev/null || { echo "indexer not reachable at $INDEXER_URL" >&2; exit 1; }

PWFILE="$(mktemp)"
chmod 600 "$PWFILE"
trap 'rm -f "$PWFILE"' EXIT
# Check the password up front: nothing is echoed while typing, so a typo is easy and should cost a retype, not a run.
for try in 1 2 3; do
  read -rs -p "Keystore password for tripwire-deployer: " PW
  echo
  printf '%s' "$PW" >"$PWFILE"
  unset PW
  if unlocked=$(cast wallet address --account tripwire-deployer --password-file "$PWFILE" 2>/dev/null); then
    if [[ "$(echo "$unlocked" | tr '[:upper:]' '[:lower:]')" != "$(echo "$DEPLOYER" | tr '[:upper:]' '[:lower:]')" ]]; then
      echo "keystore unlocks to $unlocked, expected $DEPLOYER" >&2
      exit 1
    fi
    break
  fi
  echo "That password doesn't unlock the keystore (try $try of 3)." >&2
  [[ $try -eq 3 ]] && exit 1
done

# Progress goes to stderr: stdout of the helpers below is captured (order ids, order JSON).
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG" >&2; }

# Runs one demo action. Retries only when nothing was broadcast, so a flaky RPC can never duplicate an order.
# Prints the created order id, if any.
#
# Normally each transaction waits for the previous one's receipt (--slow). Races ("bounce", "cancel-race") need the
# follow-up to land before Reactive's callback, which a receipt-by-receipt script cannot do: the callback lands about
# two blocks after the crash. Those actions submit back to back so the whole sequence shares a block or two.
demo() {
  local action="$1" order_id="${2:-}" out attempt pacing=(--slow)
  [[ "$action" == "bounce" || "$action" == "cancel-race" ]] && pacing=()
  # Up to about 2.5 minutes of patience: the public RPC has gone unreachable for minutes at a time.
  for attempt in 1 2 3 4 5 6 7 8; do
    if out=$(cd "$ROOT/contracts" && DEMO_ACTION="$action" DEMO_ORDER_ID="$order_id" forge script \
      script/demo/TripwireDemo.s.sol --rpc-url "$RPC" --account tripwire-deployer --password-file "$PWFILE" \
      --sender "$DEPLOYER" ${pacing[@]+"${pacing[@]}"} --broadcast 2>&1); then
      echo "$out" >>"$LOG"
      # Most actions create no order; under pipefail a grep with no match must not end the run.
      { echo "$out" | grep -oE "created stop-loss order [0-9]+" || true; } | awk '{print $NF}' | tail -1
      return 0
    fi
    echo "$out" >>"$LOG"
    if echo "$out" | grep -q "\[Success\]"; then
      log "  $action failed after broadcasting; not retrying"
      return 1
    fi
    if echo "$out" | grep -qiE "decrypt keystore|insufficient funds|reverted|revert"; then
      log "  $action failed: $(echo "$out" | grep -iE "error" | head -1)"
      return 1
    fi
    local wait=$((attempt < 4 ? attempt * 3 : 30))
    log "  $action failed before broadcast (attempt $attempt): $(echo "$out" | grep -m1 -E "^Error" | cut -c1-90); retrying in ${wait}s"
    sleep "$wait"
  done
  return 1
}

# Polls the indexer until a JS condition on the order view is true. Prints the order JSON on success.
await_order() {
  local id="$1" cond="$2" label="$3" deadline=$((SECONDS + WAIT_SECONDS)) json
  while ((SECONDS < deadline)); do
    json=$(curl -sf "$INDEXER_URL/api/orders/$id" || true)
    if [[ -n "$json" ]] && node -e "const o=JSON.parse(process.argv[1]); process.exit((${cond}) ? 0 : 1)" "$json"; then
      echo "$json"
      return 0
    fi
    sleep 1
  done
  log "  order #$id: timed out waiting for: $label"
  return 1
}

summary() {
  # shellcheck disable=SC2016  # the single-quoted program is JavaScript, its ${} are template literals
  node -e '
    const o = JSON.parse(process.argv[1]);
    const a = o.attempts.map((x) => `attempt ${x.attempt}: ${x.outcome ? x.outcome.kind + (x.outcome.reason ? " " + x.outcome.reason : "") : "in flight"}` +
      (x.latency.unichainBlocks !== null ? ` (${x.latency.unichainBlocks} blocks)` : ""));
    console.log(`order #${o.id}: vault ${o.status}, reactive ${o.reactiveState}${o.retireReason ? " (" + o.retireReason + ")" : ""}; ${a.join("; ")}`);
  ' "$1"
}

run_edge() {
  log "== bounce-back: crash, then the price recovers before the callback lands"
  local id json
  id=$(demo bounce)
  log "  order #$id armed, crashed and recovered"
  json=$(await_order "$id" 'o.attempts.length>=1 && o.attempts[0].outcome && o.reactiveState==="armed"' "first attempt refused and re-armed")
  log "  $(summary "$json")"
  demo crash >/dev/null
  json=$(await_order "$id" 'o.status==="executed"' "executed on the next crossing")
  log "  $(summary "$json")"
  demo recover >/dev/null

  log "== slippage: minimum output can't be met, so the vault refuses and Reactive gives up after 2 attempts"
  id=$(demo slippage)
  json=$(await_order "$id" 'o.attempts.length>=1 && o.attempts[0].outcome && o.reactiveState==="armed"' "first attempt refused and re-armed")
  log "  $(summary "$json")"
  demo crash >/dev/null
  json=$(await_order "$id" 'o.reactiveState==="done"' "retired after attempts ran out")
  log "  $(summary "$json")"
  demo cancel "$id" >/dev/null
  json=$(await_order "$id" 'o.status==="cancelled"' "cancelled and refunded")
  log "  $(summary "$json")"
  demo recover >/dev/null
  demo recover >/dev/null

  log "== cancel during flight: cancel lands right after the crash, before the callback"
  if id=$(demo cancel-race); then
    json=$(await_order "$id" 'o.reactiveState==="done" && o.attempts.length>=1 && o.attempts[0].outcome' "callback refused as NotOpen")
    log "  $(summary "$json")"
  else
    log "  cancel reverted: the callback executed first (race lost); see $LOG"
  fi
}

run_load() {
  local i id json ok=0 fail=0
  for ((i = 1; i <= N; i++)); do
    if ! id=$(demo cycle) || [[ -z "$id" ]]; then
      fail=$((fail + 1))
      log "loop $i/$N: script failed"
      continue
    fi
    if json=$(await_order "$id" 'o.status==="executed"' "executed"); then
      ok=$((ok + 1))
      log "loop $i/$N: $(summary "$json")"
    else
      fail=$((fail + 1))
    fi
  done
  log "== $ok executed, $fail failed"
}

log "mode $MODE, indexer $INDEXER_URL, log $LOG"
if [[ "$MODE" == "edge" ]]; then run_edge; else run_load; fi
log "== latency now: $(curl -s "$INDEXER_URL/api/latency")"
