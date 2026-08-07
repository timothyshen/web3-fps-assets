/**
 * Hand-copied ABI fragments, transcribed from contracts/src/*.sol and
 * contracts/src/interfaces/*.sol (NOT generated, NOT guessed). Only the
 * functions/events/errors the backend actually uses. Custom errors are
 * included so viem decodes reverts into readable names.
 */

// ---- IWeaponSkin / WeaponSkin -----------------------------------------

export const weaponSkinAbi = [
  {
    type: "function",
    name: "tokensOfOwner",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "tokenIds", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "skinData",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "skinDefId", type: "uint32" },
          { name: "serial", type: "uint32" },
          { name: "wear", type: "uint16" },
          { name: "seasonId", type: "uint32" },
          { name: "mintedAt", type: "uint64" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  // Standard ERC-721 Transfer (emitted by the OZ base WeaponSkin inherits);
  // used to resolve a token's latest acquisition block for the finality window.
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
  {
    type: "event",
    name: "SkinMinted",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "skinDefId", type: "uint32", indexed: true },
      { name: "serial", type: "uint32", indexed: false },
      { name: "wear", type: "uint16", indexed: false },
      { name: "seasonId", type: "uint32", indexed: false },
    ],
  },
  { type: "error", name: "WearOutOfRange", inputs: [{ name: "wear", type: "uint16" }] },
  { type: "error", name: "TokenDoesNotExist", inputs: [{ name: "tokenId", type: "uint256" }] },
  {
    type: "error",
    name: "NotTokenOwner",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "caller", type: "address" },
    ],
  },
  { type: "error", name: "ZeroAddress", inputs: [] },
  // OZ v5 ERC-721 error, surfaced by ownerOf() for nonexistent tokens
  { type: "error", name: "ERC721NonexistentToken", inputs: [{ name: "tokenId", type: "uint256" }] },
] as const;

// ---- IGameAssetRegistry / GameAssetRegistry ---------------------------

export const gameAssetRegistryAbi = [
  {
    type: "function",
    name: "getSkin",
    stateMutability: "view",
    inputs: [{ name: "skinDefId", type: "uint32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "maxSupply", type: "uint32" },
          { name: "minted", type: "uint32" },
          { name: "rarity", type: "uint8" },
          { name: "frozen", type: "bool" },
          { name: "exists", type: "bool" },
          { name: "contentHash", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "isDefined",
    stateMutability: "view",
    inputs: [{ name: "skinDefId", type: "uint32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "remainingSupply",
    stateMutability: "view",
    inputs: [{ name: "skinDefId", type: "uint32" }],
    outputs: [{ name: "", type: "uint32" }],
  },
  { type: "error", name: "SkinNotDefined", inputs: [{ name: "skinDefId", type: "uint32" }] },
  {
    type: "error",
    name: "SupplyExhausted",
    inputs: [
      { name: "skinDefId", type: "uint32" },
      { name: "maxSupply", type: "uint32" },
    ],
  },
] as const;

// ---- IRewardDistributor / RewardDistributor ---------------------------

export const rewardDistributorAbi = [
  {
    type: "function",
    name: "mintDirect",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "skinDefId", type: "uint32" },
      { name: "wear", type: "uint16" },
      { name: "seasonId", type: "uint32" },
      { name: "requestId", type: "bytes32" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "isRequestProcessed",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "RewardMinted",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "skinDefId", type: "uint32", indexed: true },
      { name: "requestId", type: "bytes32", indexed: false },
    ],
  },
  { type: "error", name: "InvalidSignature", inputs: [] },
  {
    type: "error",
    name: "NonceAlreadyUsed",
    inputs: [
      { name: "player", type: "address" },
      { name: "nonce", type: "uint256" },
    ],
  },
  { type: "error", name: "RequestAlreadyProcessed", inputs: [{ name: "requestId", type: "bytes32" }] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "ZeroRequestId", inputs: [] },
] as const;

// ---- IMatchAttestation / MatchAttestation -----------------------------

export const matchAttestationAbi = [
  {
    type: "function",
    name: "attest",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "bytes32" },
      { name: "resultHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "resultOf",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "isAttested",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "verify",
    stateMutability: "view",
    inputs: [
      { name: "matchId", type: "bytes32" },
      { name: "resultHash", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "MatchAttested",
    inputs: [
      { name: "matchId", type: "bytes32", indexed: true },
      { name: "resultHash", type: "bytes32", indexed: false },
      { name: "attester", type: "address", indexed: true },
      { name: "timestamp", type: "uint64", indexed: false },
    ],
  },
  {
    type: "error",
    name: "AlreadyAttested",
    inputs: [
      { name: "matchId", type: "bytes32" },
      { name: "existingHash", type: "bytes32" },
    ],
  },
  { type: "error", name: "ZeroMatchId", inputs: [] },
  { type: "error", name: "ZeroResultHash", inputs: [] },
] as const;

// ---- ITournamentEscrow / TournamentEscrow -----------------------------

export const tournamentEscrowAbi = [
  {
    type: "function",
    name: "tournamentCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getTournament",
    stateMutability: "view",
    inputs: [{ name: "tournamentId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "organizer", type: "address" },
          { name: "entryFee", type: "uint96" },
          { name: "resultSubmitter", type: "address" },
          { name: "maxParticipants", type: "uint32" },
          { name: "minParticipants", type: "uint32" },
          { name: "organizerFeeBps", type: "uint16" },
          { name: "status", type: "uint8" },
          { name: "registrationDeadline", type: "uint64" },
          { name: "resultDeadline", type: "uint64" },
          { name: "participantCount", type: "uint32" },
          { name: "prizePool", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getPayoutBps",
    stateMutability: "view",
    inputs: [{ name: "tournamentId", type: "uint256" }],
    outputs: [{ name: "", type: "uint16[]" }],
  },
  {
    type: "function",
    name: "isRegistered",
    stateMutability: "view",
    inputs: [
      { name: "tournamentId", type: "uint256" },
      { name: "player", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "prizeOf",
    stateMutability: "view",
    inputs: [
      { name: "tournamentId", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "refundableOf",
    stateMutability: "view",
    inputs: [
      { name: "tournamentId", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "Settled",
    inputs: [
      { name: "tournamentId", type: "uint256", indexed: true },
      { name: "resultHash", type: "bytes32", indexed: true },
      { name: "prizePool", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PrizeAssigned",
    inputs: [
      { name: "tournamentId", type: "uint256", indexed: true },
      { name: "winner", type: "address", indexed: true },
      { name: "rank", type: "uint8", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Cancelled",
    inputs: [
      { name: "tournamentId", type: "uint256", indexed: true },
      { name: "triggeredBy", type: "address", indexed: true },
      { name: "reason", type: "string", indexed: false },
    ],
  },
  { type: "error", name: "TournamentNotFound", inputs: [{ name: "tournamentId", type: "uint256" }] },
] as const;

/** ITournamentEscrow.Status enum order: None, Open, Settled, Cancelled. */
export const TOURNAMENT_STATUS = ["none", "open", "settled", "cancelled"] as const;
