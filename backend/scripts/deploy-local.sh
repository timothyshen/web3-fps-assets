#!/usr/bin/env bash
# Deploys the full contract suite + seed skins to a RUNNING anvil node and
# writes backend/deployments.local.json for the backend to pick up.
#
# Usage:  anvil            # terminal 1
#         ./scripts/deploy-local.sh   # terminal 2 (from backend/)
#
# Uses anvil's default funded accounts — publicly known TEST keys only.
set -euo pipefail

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
# anvil account #0 — deployer / admin / operator / attester
PRIVATE_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
# anvil account #1 — voucher signer address (pull path, unused by the demo backend)
REWARD_SIGNER_ADDRESS="${REWARD_SIGNER_ADDRESS:-0x70997970C51812dc3A010C7d01b50e0d17dc79C8}"
# Where WeaponSkin.tokenURI should point (this backend's metadata endpoint).
# Trailing slash required: tokenURI = base + decimal tokenId.
METADATA_BASE_URL="${METADATA_BASE_URL:-http://127.0.0.1:8787/metadata/}"

# forge/cast: PATH first, ~/.foundry/bin fallback.
command -v forge >/dev/null 2>&1 || PATH="$HOME/.foundry/bin:$PATH"

BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONTRACTS_DIR="$BACKEND_DIR/../contracts"
OUT_FILE="$BACKEND_DIR/deployments.local.json"

echo "==> deploying to $RPC_URL"
DEPLOY_LOG=$(cd "$CONTRACTS_DIR" && \
  PRIVATE_KEY="$PRIVATE_KEY" REWARD_SIGNER_ADDRESS="$REWARD_SIGNER_ADDRESS" \
  forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" --broadcast 2>&1)

addr() { echo "$DEPLOY_LOG" | grep -E "$1 *:" | grep -oE '0x[0-9a-fA-F]{40}' | head -1; }

REGISTRY=$(addr "GameAssetRegistry")
SKIN=$(addr "WeaponSkin")
DISTRIBUTOR=$(addr "RewardDistributor")
MARKET=$(addr "SkinMarket")
ATTESTATION=$(addr "MatchAttestation")
ESCROW=$(addr "TournamentEscrow")

if [ -z "$REGISTRY" ] || [ -z "$SKIN" ] || [ -z "$DISTRIBUTOR" ]; then
  echo "deploy failed:"; echo "$DEPLOY_LOG"; exit 1
fi

echo "==> seeding demo skins"
(cd "$CONTRACTS_DIR" && \
  PRIVATE_KEY="$PRIVATE_KEY" REGISTRY_ADDRESS="$REGISTRY" DISTRIBUTOR_ADDRESS="$DISTRIBUTOR" \
  forge script script/SeedSkins.s.sol:SeedSkins --rpc-url "$RPC_URL" --broadcast >/dev/null)

echo "==> pointing WeaponSkin.tokenURI at $METADATA_BASE_URL"
cast send "$SKIN" "setBaseURI(string)" "$METADATA_BASE_URL" \
  --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" >/dev/null

CHAIN_ID=$(printf '%d' "$(curl -s "$RPC_URL" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | grep -oE '"result":"[^"]+"' | cut -d'"' -f4)")

cat > "$OUT_FILE" <<JSON
{
  "chainId": $CHAIN_ID,
  "contracts": {
    "gameAssetRegistry": "$REGISTRY",
    "weaponSkin": "$SKIN",
    "rewardDistributor": "$DISTRIBUTOR",
    "skinMarket": "$MARKET",
    "matchAttestation": "$ATTESTATION",
    "tournamentEscrow": "$ESCROW"
  }
}
JSON

echo "==> wrote $OUT_FILE"
cat "$OUT_FILE"
echo "==> now: cp .env.example .env && npm run dev"
