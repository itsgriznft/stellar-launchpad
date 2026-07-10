#!/usr/bin/env bash
#
# Deploy the launchpad to a Stellar network.
#
#   ./scripts/deploy.sh [network] [identity]
#
# Uploads the campaign wasm, deploys the factory pointing at that wasm hash, and
# writes the resulting ids to deployments/<network>.json. Re-running is safe:
# uploading the same bytes yields the same hash, and a fresh factory is deployed.
#
# Requires: stellar CLI, jq.

set -euo pipefail

NETWORK="${1:-testnet}"
IDENTITY="${2:-deployer}"

CAMPAIGN_WASM="target/wasm32v1-none/release/campaign.wasm"
FACTORY_WASM="target/wasm32v1-none/release/factory.wasm"
OUT_DIR="deployments"
OUT="$OUT_DIR/$NETWORK.json"

step() { printf '\n\033[1;33m==>\033[0m %s\n' "$1"; }

for tool in stellar jq; do
  command -v "$tool" >/dev/null || { echo "error: $tool is not installed" >&2; exit 1; }
done

step "Building contracts"
make build

step "Ensuring identity '$IDENTITY' exists and is funded"
if ! stellar keys address "$IDENTITY" >/dev/null 2>&1; then
  stellar keys generate "$IDENTITY" --network "$NETWORK" --fund
fi
ADMIN="$(stellar keys address "$IDENTITY")"
echo "admin: $ADMIN"

step "Resolving the native XLM asset contract"
TOKEN="$(stellar contract id asset --asset native --network "$NETWORK")"
echo "token: $TOKEN"

step "Uploading campaign wasm"
CAMPAIGN_HASH="$(stellar contract upload \
  --wasm "$CAMPAIGN_WASM" \
  --source "$IDENTITY" --network "$NETWORK")"
echo "campaign wasm hash: $CAMPAIGN_HASH"

step "Deploying factory"
FACTORY_ID="$(stellar contract deploy \
  --wasm "$FACTORY_WASM" \
  --source "$IDENTITY" --network "$NETWORK" \
  -- \
  --admin "$ADMIN" \
  --token "$TOKEN" \
  --campaign_wasm "$CAMPAIGN_HASH")"
echo "factory: $FACTORY_ID"

step "Writing $OUT"
mkdir -p "$OUT_DIR"
jq -n \
  --arg network "$NETWORK" \
  --arg admin "$ADMIN" \
  --arg token "$TOKEN" \
  --arg campaignWasmHash "$CAMPAIGN_HASH" \
  --arg factoryId "$FACTORY_ID" \
  '{network: $network, admin: $admin, token: $token, campaignWasmHash: $campaignWasmHash, factoryId: $factoryId}' \
  > "$OUT"
cat "$OUT"

cat <<EOF

Done. Point the frontend at this deployment:

  VITE_FACTORY_ID=$FACTORY_ID npm --prefix web run dev

Create a campaign:

  stellar contract invoke --id $FACTORY_ID --source $IDENTITY --network $NETWORK \\
    -- create --creator $ADMIN --title "My campaign" \\
    --goal 10000000000 --deadline \$(( \$(date +%s) + 2592000 ))
EOF
