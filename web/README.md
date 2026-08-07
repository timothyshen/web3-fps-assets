# ASH LEDGER — web app

Web application for the `web3-fps-assets` skin-NFT layer (hackathon demo).
Covers the four web-side items from `docs/roadmap.md`: wallet connect, the
SIWE bind page Unity sends players to, the closet (on-chain inventory), and
the SkinMarket listing / buying loop.

Stack: Vite + React 18 + TypeScript, wagmi v2 + viem, @tanstack/react-query,
react-router. Plain CSS, dark industrial. No secrets anywhere in this app —
everything is public client configuration.

## Quick start (no backend, no deployment needed)

```bash
cd web
npm install
cp .env.example .env        # defaults: Monad testnet + mock bind API
npm run dev                 # http://localhost:5173
```

With `VITE_MOCK_API=1` (the `.env.example` default) the whole **bind flow is
demoable today**: open the console page, press "Open a sample bind session",
connect a wallet, sign — the mock backend verifies the real signature and
marks the session bound. Closet and market need deployed contracts (below).

## Pages

| Route | What it does |
|---|---|
| `/` | Connect wallet, network/config status, links, demo bind entry |
| `/bind/:sessionId` | Landing page from the Unity system browser: fetch challenge → SIWE sign → complete |
| `/closet` | `WeaponSkin.tokensOfOwner` + per-token `skinData` + `GameAssetRegistry.getSkin`, rendered as cards |
| `/market` | Active SkinMarket listings, list-your-skin flow (approve + list), buy, cancel, EIP-2981 royalty info |

## Environment variables

All variables are optional; defaults target Monad testnet with the mock API
off unless you copy `.env.example`. Everything here is public — no keys.

| Variable | Default | Purpose |
|---|---|---|
| `VITE_CHAIN` | `monadTestnet` | `monadTestnet` (10143, MON) or `anvil` (31337, local) |
| `VITE_RPC_URL` | per-chain default | RPC override for the selected chain |
| `VITE_ADDR_GAME_ASSET_REGISTRY` | — | GameAssetRegistry address |
| `VITE_ADDR_WEAPON_SKIN` | — | WeaponSkin address |
| `VITE_ADDR_REWARD_DISTRIBUTOR` | — | RewardDistributor address (config display only) |
| `VITE_ADDR_SKIN_MARKET` | — | SkinMarket address |
| `VITE_ADDR_MATCH_ATTESTATION` | — | MatchAttestation address (config display only) |
| `VITE_ADDR_TOURNAMENT_ESCROW` | — | TournamentEscrow address (config display only) |
| `VITE_API_BASE_URL` | `http://localhost:8787` | Asset backend base URL (bind endpoints) |
| `VITE_MOCK_API` | off | `1` fakes the bind API in-browser |
| `VITE_PRIVY_APP_ID` | — | Enables Privy embedded wallets (email/social) |
| `VITE_MULTICALL3_ADDRESS` | — | Adds Multicall3 to a chain that lacks it (anvil fork) |

### Chain config: one source, no scattered chainIds

`src/config/chain.ts` is the **single** chain-truth module
(`docs/integration.md` explicitly forbids hardcoding chainIds in multiple
places). It defines Monad testnet (10143, MON, `testnet-rpc.monad.xyz`,
`testnet.monadexplorer.com`, canonical Multicall3) and anvil (31337), applies
`VITE_RPC_URL` / `VITE_MULTICALL3_ADDRESS`, and exports `activeChain`,
transports, and explorer-URL helpers. Every other module imports from it.

### Contract addresses: env vars + deployments.json override

Addresses resolve at boot in `src/providers/ContractsProvider.tsx`:

1. `VITE_ADDR_*` env vars (inlined at build time), then
2. `public/deployments.json` (fetched at **runtime**) overrides them.

So a static build can be re-pointed at fresh deployments by swapping one
JSON file — no code changes, no rebuild. Format
(`public/deployments.example.json`, keys follow `api/openapi.yaml`
`ChainConfig.contracts`):

```json
{
  "chainId": 10143,
  "contracts": {
    "gameAssetRegistry": "0x…",
    "weaponSkin": "0x…",
    "rewardDistributor": "0x…",
    "skinMarket": "0x…",
    "matchAttestation": "0x…",
    "tournamentEscrow": "0x…"
  }
}
```

A file whose `chainId` differs from the active chain is ignored (a stale
testnet file cannot poison an anvil run). Zero/invalid addresses are treated
as unset. The Home page shows exactly which source each address came from.

## Wallets

Per `docs/integration.md` (钱包选型): embedded **and** injected wallets are
offered simultaneously.

- **Injected** (MetaMask etc.) works out of the box — wagmi's `injected()`
  connector plus automatic EIP-6963 multi-wallet discovery.
- **Privy embedded wallets** (email / Google / wallet in one modal) activate
  when `VITE_PRIVY_APP_ID` is set. The integration is strictly optional:
  `src/providers/Web3Provider.tsx` lazy-loads the Privy provider stack only
  when the env var exists, so without it the app builds, runs, and never even
  downloads the Privy chunk. Create an app at dashboard.privy.io, allow the
  app origin, paste the App ID.

Wrong-network states show a switch banner (`wallet_switchEthereumChain`,
with add-chain fallback via wagmi).

## Bind flow (`/bind/:sessionId`)

Sequence (mirrors `docs/integration.md` 钱包绑定 and `api/openapi.yaml`):

1. Unity calls `POST /v1/wallet/bind` (game session auth) → backend returns
   `{ sessionId, bindUrl, expiresAt }` where **`bindUrl` must be
   `{web-origin}/bind/{sessionId}`** — that is this page. Unity opens it in
   the system browser (never an embedded WebView).
2. This page fetches the bind challenge (nonce, expiry, state).
3. Player connects a wallet and signs an **EIP-4361 (SIWE)** message via
   `personal_sign` (wagmi `signMessage` — free, no transaction).
4. This page POSTs `{ message, signature }` back; the backend verifies and
   links playerId ↔ address.
5. Unity keeps polling `GET /v1/wallet/bind/{sessionId}` and picks up
   `{ state: "bound", wallet }`.

The SIWE message is built with viem's `createSiweMessage` (`src/lib/siwe.ts`)
— spec-exact EIP-4361, no extra dependency (the `siwe` npm package would drag
in an ethers peer dependency for what is, on the client, just string
construction). Fields: `domain`/`uri` = page origin, `chainId` = active
chain, `nonce` + `expirationTime` from the challenge, and the **sessionId in
`Request ID`** (also echoed in the statement). Example:

```
localhost:5173 wants you to sign in with your Ethereum account:
0xbB42…92d1

Link this wallet to your game account (bind session demo-abc123). Signing is
free and authorizes no transaction or spending.

URI: http://localhost:5173
Version: 1
Chain ID: 10143
Nonce: 3438cd04…
Issued At: 2026-08-07T15:46:23.730Z
Expiration Time: 2026-08-07T16:01:23.730Z
Request ID: demo-abc123
```

### Assumed backend contract — TO ALIGN WITH BACKEND

The asset backend does not exist yet. `api/openapi.yaml` defines the two
Unity-facing endpoints; the **two web-facing endpoints below are this app's
assumption** and live behind one typed client (`src/api/`). When the backend
is built, align there (or change these two files — nothing else touches HTTP).

**`GET {VITE_API_BASE_URL}/v1/wallet/bind/{sessionId}/challenge`**

```json
200: {
  "sessionId": "b7b1…",
  "nonce": "8+ alphanumeric chars (EIP-4361 requirement)",
  "expiresAt": "2026-08-07T16:01:23.730Z",
  "state": "pending | bound | expired | failed",
  "wallet": "0x… (only when state = bound)"
}
404: { "code": "session_not_found", "message": "…" }
```

**`POST {VITE_API_BASE_URL}/v1/wallet/bind/{sessionId}/complete`**

```json
body: { "message": "<exact EIP-4361 string that was signed>", "signature": "0x…" }

200: { "state": "bound", "wallet": "0x…" }
errors (shape { "code", "message" }, code values assumed):
  400 invalid_message      — nonce/requestId/expiry mismatch with the session
  400 invalid_signature    — signature does not recover to the message address
  404 session_not_found
  409 already_bound        — this session already completed
  409 wallet_already_bound — wallet linked to another player account
  410 session_expired
```

Backend verification checklist: parse the message (viem `parseSiweMessage` /
`verifySiweMessage`, or the `siwe` package), check `domain` against the
expected web origin, `nonce` + `Request ID` against the session, expiry, then
recover the signer and compare to the message address. Record playerId ↔
address; never hold keys. Note the state string set matches
`WalletBindStatus` in `api/openapi.yaml`, so the Unity poll endpoint can be
served from the same session row.

### Mock mode (`VITE_MOCK_API=1`)

`src/api/mockBindApi.ts` fakes exactly those two calls in-browser, with
realistic latency and localStorage persistence per sessionId. It is not a
rubber stamp: it parses the SIWE message, checks nonce / Request ID / expiry,
and **recovers the real signature** (`recoverMessageAddress`) — the same
checks the backend will run. Sessions expire after 15 minutes; expired /
already-bound / invalid-signature paths are all reachable for demo purposes.

## Closet (`/closet`)

Read pipeline (`src/hooks/useCloset.ts`), exactly the backend recipe from
`docs/integration.md`:

1. `WeaponSkin.tokensOfOwner(address)` → `uint256[]`
2. `WeaponSkin.skinData(tokenId)` for each — **batched via Multicall3**
3. `GameAssetRegistry.getSkin(skinDefId)` for unique defIds — batched

Cards show name, rarity, wear (raw uint16 万分比 rendered as the 0..1 float
the API uses), serial / maxSupply, season, mint date, tokenId, contentHash,
frozen flag. **tokenIds are uint256 and stay decimal strings in all UI
state** (`docs/integration.md` hard constraint); `BigInt` conversion happens
only at the viem call boundary.

Batching: `src/lib/batchRead.ts` uses `client.multicall` when the active
chain defines Multicall3 (Monad testnet does; canonical address) and falls
back to parallel `eth_call` otherwise (plain anvil), so the same code runs on
both targets.

Skin display names: the chain stores no names, and the metadata API
(`tokenURI` backend) does not exist yet, so `src/config/skinCatalog.ts`
mirrors `contracts/script/SeedSkins.s.sol` (1001/1010/1025/1042/1077) with a
`Skin #<id>` fallback. Swap for `tokenURI` fetches once the backend exists.

## Market (`/market`)

ABIs are hand-written minimal fragments in `src/abi/*.ts`, copied from the
`.sol` sources (including custom errors, so reverts decode to e.g.
`ListingStale`).

**How listings are enumerated — the decision.** `SkinMarket` has no
"all listings" view; its readable surface is `getListing(tokenId)`,
`isActive(tokenId)` and the `Listed`/`Cancelled`/`Sold` events. Options:

- (a) `eth_getLogs` over `Listed`, replayed against current state — needs the
  deploy block plus RPC log-range limits handled; fragile on public
  endpoints.
- (b) **Enumerate all tokenIds via WeaponSkin's ERC721Enumerable**
  (`totalSupply` + `tokenByIndex`, multicalled), then multicall
  `getListing` for each and keep entries with a non-zero seller.

(b) is implemented (`src/hooks/useMarket.ts`): the collection carries
Enumerable precisely so nobody needs an indexer (`docs/contracts.md`), it
needs zero configuration, works identically on anvil and Monad, and reads
current mapping state instead of replaying events. It is O(totalSupply),
capped at 2000 tokens (far beyond demo scale; a banner reports truncation).
Past that scale, switch to (a) or an indexer — the events are already in
`src/abi/skinMarket.ts`.

Per listing the app also multicalls `isActive` (zombie listings — seller
moved the skin or revoked approval — render as STALE and cannot be bought,
exactly what `ISkinMarket` prescribes) and `royaltyInfo(tokenId, price)`
(EIP-2981) to show the royalty percentage and receiver.

Flows (`src/hooks/useMarketActions.ts`):

- **List**: fresh `isApprovedForAll` check → `setApprovalForAll(market,
  true)` if needed (one-time) → `list(tokenId, price)`; price is validated
  as `0 < wei ≤ uint96.max`. Step-by-step progress is shown.
- **Buy**: `buy(tokenId)` with `value = price` (contract refunds overpay;
  the app sends exact).
- **Cancel**: for your own listings.

Prices are native MON (ETH on anvil, symbol comes from the chain config).
Amounts display formatted with the raw wei in the tooltip, per the
`Amount` convention in `api/openapi.yaml`.

## Scripts / quality gate

```bash
npm run dev       # vite dev server
npm run build     # tsc --noEmit && vite build  (passes clean)
npm run lint      # tsc --noEmit (strict; no eslint config to maintain)
npm run preview   # serve dist/
```

TypeScript is strict (`strict`, `noUnusedLocals`, `noUnusedParameters`).

## Still needed from outside this app

- [ ] **Deployed contract addresses** — run `contracts/script/Deploy.s.sol`
      (+ `SeedSkins.s.sol` for demo data), then fill `VITE_ADDR_*` or
      `public/deployments.json`.
- [ ] **RPC URL** — the public `https://testnet-rpc.monad.xyz` works but is
      rate-limited; set `VITE_RPC_URL` to a dedicated endpoint for demos.
- [ ] **Asset backend** — implement the two assumed bind endpoints above
      (plus the Unity-facing ones in `api/openapi.yaml`); point
      `VITE_API_BASE_URL` at it and drop `VITE_MOCK_API`. The backend's
      `bindUrl` must point at this app's `/bind/{sessionId}`.
- [ ] **Privy App ID** (optional but recommended for the demo) — create an
      app, allow the web origin, set `VITE_PRIVY_APP_ID`.
- [ ] Testnet MON in demo wallets (faucet linked on the console page).

## Structure

```
web/
├── index.html
├── package.json / tsconfig.json / vite.config.ts
├── .env.example                  # all public config, no secrets
├── public/deployments.example.json
└── src/
    ├── abi/                      # hand-written minimal ABI fragments (+ errors)
    │   ├── weaponSkin.ts
    │   ├── gameAssetRegistry.ts
    │   └── skinMarket.ts
    ├── api/                      # typed bind client: http impl + mock impl
    │   ├── types.ts / http.ts / bindApi.ts / mockBindApi.ts / index.ts
    ├── config/
    │   ├── env.ts                # single reader of import.meta.env
    │   ├── chain.ts              # SINGLE chain-truth module
    │   ├── contracts.ts          # typed addresses: env + deployments.json
    │   └── skinCatalog.ts        # demo names, mirrors SeedSkins.s.sol
    ├── lib/                      # siwe builder, batched reads, formatting, errors
    ├── providers/                # wagmi / optional lazy Privy / contracts context
    ├── hooks/                    # useCloset, useMarket, useMarketActions
    ├── components/               # layout, connect, cards, notices, countdown
    └── pages/                    # Home, Bind, Closet, Market
```
