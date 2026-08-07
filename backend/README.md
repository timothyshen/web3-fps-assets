# Asset backend

The Node/TS service behind `api/openapi.yaml` — the four jobs from
`docs/integration.md` (inventory reads, reward settlement, wallet binding,
entitlement checks) plus match attestation and tournament reads. One
hackathon-lean service, no microservices.

Stack: **Fastify** (over Express: first-class async handlers + one central
error hook that funnels every failure into the openapi `{code,message}`
envelope, structured logging built in), **zod** validation, **viem** for all
chain access, **better-sqlite3** for durable state, **jose** for JWTs.

## Run order (local demo)

```bash
# 0. one-time: install deps (contracts/lib too, see repo README)
cd backend && npm install

# 1. chain
anvil

# 2. deploy + seed (writes backend/deployments.local.json)
./scripts/deploy-local.sh

# 3. backend
cp .env.example .env      # anvil defaults; publicly known test keys only
npm run dev               # http://127.0.0.1:8787

# 4. (optional) web app: cd ../web && npm run dev — its .env should point
#    VITE_API_BASE_URL=http://localhost:8787 and VITE_CHAIN=anvil
```

Point Unity's `HttpGameAssetGateway` at `http://127.0.0.1:8787` with a token
from `POST /v1/auth/login`.

## Tests

```bash
npm test        # tsc --noEmit (strict) + vitest run
npm run test:unit
```

`npm test` boots its own stack (anvil on port 18545 → `Deploy.s.sol` →
`SeedSkins.s.sol` → backend on 18787) via `test/globalSetup.ts`, then runs:

- **unit**: RFC 8785 canonicalization reproduces
  `fixtures/match-result-v1.canonical.json` byte-for-byte, resultHash /
  matchIdKey match the expected vectors, requestId derivation matches
  cast-computed references;
- **integration**: login → empty closet → real SIWE bind (fresh viem wallet
  signs the real EIP-4361 message) → match submit (fixture-consistent hash,
  conflict rejection) → claim through claimable→processing→pending_chain→
  confirmed with the tokenId visible in the closet → loadout 204/403 →
  entitlement snapshot → double-claim does not double-mint (chain balance
  asserted) → background attestation verified on-chain → tournaments
  list/detail/intents.

Requires `anvil`/`forge` (looked up on PATH, falling back to
`~/.foundry/bin`). Ports 18545/18787 must be free (`TEST_ANVIL_PORT` /
`TEST_BACKEND_PORT` to override).

## Endpoints

Unity-facing, from `api/openapi.yaml` (Bearer **player JWT** unless noted):

| Endpoint | Notes |
|---|---|
| `GET /v1/config` | public; chain + contract addresses, never hardcode them client-side |
| `GET /v1/assets` | closet from `tokensOfOwner`+`skinData`+`getSkin`, 20s TTL cache, honest `stalenessSeconds`; unbound wallet → empty items, `wallet: ""` |
| `PUT /v1/loadout` | 204; fresh per-token `ownerOf` revalidation, 403 `not_owned`/`unknown_token` |
| `POST /v1/wallet/bind` | → `{sessionId, bindUrl, expiresAt}`, `bindUrl = {WEB_ORIGIN}/bind/{sessionId}`; 409 `already_bound` |
| `GET /v1/wallet/bind/{sessionId}` | Unity poll: `pending → bound` |
| `POST /v1/rewards/{rewardId}/claim` | push path (`requiresPlayerAction: false`), idempotent; 409 `wallet_not_bound`/`reward_held`/`reward_expired` |
| `GET /v1/rewards/{rewardId}` | state machine `claimable→processing→pending_chain→confirmed/failed`, `tokenId` on confirmed |
| `GET /v1/matches/{matchId}` | public; `canonicalJson` + `resultHash` + attestation state |
| `GET /v1/tournaments` (+`/{id}`, `/{id}/intents/{action}`) | read from `TournamentEscrow` (`tournamentCount` enumeration); intents validate feasibility then return `actionUrl = {WEB_ORIGIN}/tournaments/{id}/{action}` |
| `GET /metadata/{tokenId}` | public ERC-721 metadata, where `WeaponSkin.tokenURI` points (see below); 404 for nonexistent/burned tokens; 60s cache; permissive CORS |

Web-facing (no game JWT — the browser only has the sessionId; contract from
`web/README.md` "TO ALIGN WITH BACKEND", implemented exactly):

| Endpoint | Notes |
|---|---|
| `GET /v1/wallet/bind/{sessionId}/challenge` | `{sessionId, nonce, expiresAt, state, wallet?}`; 404 `session_not_found` |
| `POST /v1/wallet/bind/{sessionId}/complete` | body `{message, signature}`; SIWE verification (domain whitelist, chainId, single-use nonce, `Request ID` = sessionId, expiry, signature recovery incl. ERC-1271 fallback); errors `invalid_message` 400, `invalid_signature` 400, `session_not_found` 404, `already_bound` 409, `wallet_already_bound` 409, `session_expired` 410 |

Server-to-server (Bearer **`INTERNAL_SERVICE_TOKEN`**, never the player JWT):

| Endpoint | Notes |
|---|---|
| `POST /internal/v1/matches` | canonicalizes (RFC 8785) + `resultHash = keccak256(bytes)`; idempotent by matchId (identical re-push → 200, different content → 409 `match_conflict`); creates rewards from `rewardSlots` (`passed`→claimable, `held`→held, `rejected`→none); queues attestation — attestation failure never fails this endpoint |
| `POST /internal/v1/entitlement-check` | per-slot resolution (granted vs default fallback + rejection reason incl. `not_confirmed`), persisted `snapshotId`; dependency failure → `allowed: true, degraded: true` default-skin snapshot |
| `POST /internal/v1/rewards/{rewardId}/review` | **the anti-cheat review seam** (internal-only, never client-reachable). Body `{decision: "release"\|"reject", reason?}`. `release`: held → claimable. `reject`: held → **terminal** failed with a `lowercase_snake_case` reason code surfaced via `RewardStatus.error` (claim retries answer 409 `reward_rejected`; ordinary mint-failed rewards stay retryable). Same-outcome repeats are idempotent 200s; anything else 409 `wrong_state`. Exists because mints are irreversible — risk control must happen before the mint (docs/security.md T4) |

Demo-only extension (NOT in openapi.yaml, deliberately):

| Endpoint | Notes |
|---|---|
| `POST /v1/auth/login` `{playerId}` → `{accessToken}` | stand-in for the game studio's account system so the Web3 stack demos standalone. **Production replaces this** with real account auth issuing the same `gameSession` JWT. |

## How the pieces work

- **Rewards / idempotency** — reward rows carry
  `UNIQUE(matchId, playerId, slot)`;
  `requestId = keccak256(abi.encode(string matchId, string playerId, uint8 slot))`
  exactly as `docs/integration.md` shows. Retries are stopped in order by:
  the DB unique index, a guarded state-transition UPDATE, and finally the
  contract's own requestId check — a retry never re-spends gas. Which skin a
  reward mints is a **demo policy** (`src/catalog.ts`): derived
  deterministically from the rewardId over the five seeded skins, because the
  game-server payload does not carry skin choice; production replaces it with
  the real loot/season config.
- **Skin names** — the chain stores no names; for the demo they exist only in
  `contracts/script/SeedSkins.s.sol`, so `src/catalog.ts` mirrors that script
  (same as `web/src/config/skinCatalog.ts`). Keep in sync until a real
  metadata pipeline exists. Rarity/supply/contentHash always come from the
  registry, never the mirror.
- **Hashing** — `src/jcs.ts` implements RFC 8785 locally and is validated
  byte-for-byte against `fixtures/` (the fixtures README requires exactly
  this).
- **Finality window** (docs/security.md T6) — `CONFIRMATION_BLOCKS` (default
  0 = optimistic, right for anvil; **2 suggested for Monad testnet**, whose
  MonadBFT finalizes in about a second). A token is `confirmed` iff
  `head − acquisitionBlock ≥ CONFIRMATION_BLOCKS`, where the acquisition
  block is the latest `Transfer(to=wallet)` (one `getLogs` per closet read;
  our own mints also persist their receipt block as a fallback). Inside the
  window `SkinItem.state` is `"pending"` and the token is NOT equippable:
  `PUT /v1/loadout` answers 403 `not_confirmed` and entitlement checks
  resolve the slot to the default skin with reason `not_confirmed`
  (openapi AST-004). Closet cache entries keep the acquisition block, so
  `state` is re-derived against the live head on cache hits — pending flips
  to confirmed without waiting out the TTL. Note the reward state machine is
  unchanged: a claim is `confirmed` when its tx lands; with a window > 0 the
  ITEM stays `pending` a little longer, and `SkinItem.state` is what gates
  equipping. Degradation: if log queries fail, state falls back to the
  optimistic pre-window behavior (never blocks play on a log-RPC hiccup).
- **Metadata / tokenURI** — `WeaponSkin.tokenURI = baseTokenURI + decimal
  tokenId`; `scripts/deploy-local.sh` calls `setBaseURI` (URI_ADMIN_ROLE)
  pointing it at `{backend}/metadata/`, so anvil-minted tokens resolve
  end-to-end. `GET /metadata/{tokenId}` serves standard ERC-721 JSON: name
  `"<catalog name> #<serial>"`, description, placeholder `image`
  (`{BUNDLE_BASE_URL}/previews/{skinDefId}.png` — no art pipeline exists
  yet), and attributes (skin, rarity, wear 0..1, serial, max supply,
  season, contentHash) read from `skinData` + the registry.
- **Degradation** (`docs/integration.md` 降级矩阵, live-verified):
  RPC down → `/v1/assets` serves the stale cache with an honest, growing
  `stalenessSeconds` (503 `chain_unavailable` only when nothing was ever
  cached); claims accept and then park as `failed` with an explicit
  `chain_unavailable` error (retryable); tournament reads return 503
  `chain_unavailable`; entitlement returns an allowed+degraded default-skin
  snapshot; binding keeps working (EOA signature recovery is offline).
  Nothing takes the process down.
- **Background workers** — attestation runs on an in-process retry loop
  (exponential backoff, `ATTEST_MAX_ATTEMPTS`, terminal `failed` state stays
  visible via `GET /v1/matches/{id}`); mint jobs run per-reward with a
  process-wide tx lock (one operator account → no nonce races) and recover
  lost confirmations from `RewardMinted` logs via the on-chain requestId.

## Environment

See `.env.example` (anvil defaults; the only keys in it are anvil's publicly
known test keys). Highlights: `RPC_URL`/`CHAIN_ID`/`CHAIN_NAME`,
`ADDR_*` or `DEPLOYMENTS_FILE`, `OPERATOR_PRIVATE_KEY` (needs
`OPERATOR_ROLE` + `ATTESTER_ROLE`; the Deploy script leaves both with the
deployer when `ADMIN_ADDRESS` is unset), `JWT_SECRET`,
`INTERNAL_SERVICE_TOKEN`, `WEB_ORIGIN` (bind + tournament action URLs,
SIWE domain whitelist, CORS), `CONFIRMATION_BLOCKS` (finality window),
cache/TTL knobs, `DB_PATH`. `scripts/deploy-local.sh` also honors
`METADATA_BASE_URL` (default `http://127.0.0.1:8787/metadata/`, trailing
slash required) for the on-chain base URI.

For Monad testnet: set `RPC_URL`/`CHAIN_ID=10143`/`CHAIN_NAME`/`NATIVE_SYMBOL=MON`,
`MULTICALL3_ADDRESS=0xcA11bde05977b3631167028862bE2a173976CA11`, the deployed
`ADDR_*`, a funded operator key, `CONFIRMATION_BLOCKS=2`, and re-point the
base URI at the backend's public host.

## Production TODOs (hackathon shortcuts, on purpose)

- **Real account system** — replace `/v1/auth/login` with the studio's
  account service; keep the `gameSession` JWT contract.
- **Key management** — `OPERATOR_PRIVATE_KEY` moves to KMS with signing
  limits + mint-rate alerting (docs/security.md T1/T8); separate the
  attester key from the operator key.
- **Durable queue** — attestation/mint workers move from the in-process
  SQLite poller to a durable queue with visibility timeouts; SQLite →
  Postgres when more than one instance runs.
- **Finality policy** — implemented as a block-count window
  (`CONFIRMATION_BLOCKS`); production should key it to Monad's actual
  finalized-block signal rather than a fixed count, and index Transfer
  events instead of ad-hoc `getLogs` once volume grows.
- **Anti-cheat gate** — the review seam exists
  (`/internal/v1/rewards/{id}/review`); production needs the actual review
  tooling/automation in front of it. Mints are irreversible so risk control
  must stay pre-mint.
- **Re-bind flow** — one wallet per player is enforced; changing wallets
  (openapi 409 换绑需重新认证) needs a re-auth flow.
- **ERC-1271 smart wallets** — verified only when the RPC is up; embedded
  smart-contract wallets should get a first-class path.
- **Metadata hosting** — `/metadata/{tokenId}` exists and `tokenURI` points
  at it locally; production re-points the base URI at a public host, swaps
  the placeholder `image` scheme for the real art pipeline, and replaces
  the `src/catalog.ts` name mirror with the content pipeline's data.
