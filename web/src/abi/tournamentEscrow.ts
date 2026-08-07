import { parseAbiItem } from 'viem'

/**
 * Minimal hand-written ABI fragment for TournamentEscrow
 * (contracts/src/TournamentEscrow.sol / interfaces/ITournamentEscrow.sol).
 *
 * Read surface found in the .sol (all used by the app):
 *   tournamentCount / getTournament / getPayoutBps / isRegistered /
 *   prizeOf / refundableOf / canCancel
 * `tournamentCount` + sequential ids (1..count) make list enumeration a
 * plain multicall — no getLogs needed for the list page.
 *
 * What is NOT in state and must come from events:
 *   - winners + per-rank amounts  -> PrizeAssigned
 *   - cancellation reason         -> Cancelled (string reason)
 *   - resultHash                  -> Settled
 * Those three events are exported standalone for viem getLogs.
 *
 * Status enum: 0 None, 1 Open, 2 Settled, 3 Cancelled.
 * All custom errors included so reverts decode to their names.
 */

export const prizeAssignedEvent = parseAbiItem(
  'event PrizeAssigned(uint256 indexed tournamentId, address indexed winner, uint8 rank, uint256 amount)',
)

export const cancelledEvent = parseAbiItem(
  'event Cancelled(uint256 indexed tournamentId, address indexed triggeredBy, string reason)',
)

export const settledEvent = parseAbiItem(
  'event Settled(uint256 indexed tournamentId, bytes32 indexed resultHash, uint256 prizePool)',
)

const tournamentComponents = [
  { name: 'organizer', type: 'address' },
  { name: 'entryFee', type: 'uint96' },
  { name: 'resultSubmitter', type: 'address' },
  { name: 'maxParticipants', type: 'uint32' },
  { name: 'minParticipants', type: 'uint32' },
  { name: 'organizerFeeBps', type: 'uint16' },
  { name: 'status', type: 'uint8' },
  { name: 'registrationDeadline', type: 'uint64' },
  { name: 'resultDeadline', type: 'uint64' },
  { name: 'participantCount', type: 'uint32' },
  { name: 'prizePool', type: 'uint256' },
] as const

export const tournamentEscrowAbi = [
  {
    type: 'function',
    name: 'tournamentCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getTournament',
    stateMutability: 'view',
    inputs: [{ name: 'tournamentId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct ITournamentEscrow.Tournament',
        components: tournamentComponents,
      },
    ],
  },
  {
    type: 'function',
    name: 'getPayoutBps',
    stateMutability: 'view',
    inputs: [{ name: 'tournamentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint16[]' }],
  },
  {
    type: 'function',
    name: 'isRegistered',
    stateMutability: 'view',
    inputs: [
      { name: 'tournamentId', type: 'uint256' },
      { name: 'player', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'prizeOf',
    stateMutability: 'view',
    inputs: [
      { name: 'tournamentId', type: 'uint256' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'refundableOf',
    stateMutability: 'view',
    inputs: [
      { name: 'tournamentId', type: 'uint256' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'canCancel',
    stateMutability: 'view',
    inputs: [
      { name: 'tournamentId', type: 'uint256' },
      { name: 'caller', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'register',
    stateMutability: 'payable',
    inputs: [{ name: 'tournamentId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'sponsor',
    stateMutability: 'payable',
    inputs: [{ name: 'tournamentId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claimPrize',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'tournamentId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claimRefund',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'tournamentId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancel',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'tournamentId', type: 'uint256' }],
    outputs: [],
  },
  prizeAssignedEvent,
  cancelledEvent,
  settledEvent,
  {
    type: 'event',
    name: 'TournamentCreated',
    inputs: [
      { name: 'tournamentId', type: 'uint256', indexed: true },
      { name: 'organizer', type: 'address', indexed: true },
      { name: 'resultSubmitter', type: 'address', indexed: true },
      { name: 'entryFee', type: 'uint96', indexed: false },
      { name: 'registrationDeadline', type: 'uint64', indexed: false },
      { name: 'resultDeadline', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Registered',
    inputs: [
      { name: 'tournamentId', type: 'uint256', indexed: true },
      { name: 'player', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Sponsored',
    inputs: [
      { name: 'tournamentId', type: 'uint256', indexed: true },
      { name: 'sponsor', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PrizeClaimed',
    inputs: [
      { name: 'tournamentId', type: 'uint256', indexed: true },
      { name: 'winner', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'RefundClaimed',
    inputs: [
      { name: 'tournamentId', type: 'uint256', indexed: true },
      { name: 'payer', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  { type: 'error', name: 'TournamentNotFound', inputs: [{ name: 'tournamentId', type: 'uint256' }] },
  {
    type: 'error',
    name: 'WrongStatus',
    inputs: [
      { name: 'tournamentId', type: 'uint256' },
      { name: 'actual', type: 'uint8' },
      { name: 'expected', type: 'uint8' },
    ],
  },
  { type: 'error', name: 'RegistrationClosed', inputs: [{ name: 'tournamentId', type: 'uint256' }] },
  { type: 'error', name: 'TournamentFull', inputs: [{ name: 'tournamentId', type: 'uint256' }] },
  {
    type: 'error',
    name: 'AlreadyRegistered',
    inputs: [
      { name: 'tournamentId', type: 'uint256' },
      { name: 'player', type: 'address' },
    ],
  },
  {
    type: 'error',
    name: 'IncorrectEntryFee',
    inputs: [
      { name: 'expected', type: 'uint96' },
      { name: 'sent', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'NotResultSubmitter', inputs: [{ name: 'caller', type: 'address' }] },
  { type: 'error', name: 'TooEarlyToSettle', inputs: [{ name: 'tournamentId', type: 'uint256' }] },
  { type: 'error', name: 'ResultDeadlinePassed', inputs: [{ name: 'tournamentId', type: 'uint256' }] },
  {
    type: 'error',
    name: 'NotEnoughParticipants',
    inputs: [
      { name: 'actual', type: 'uint32' },
      { name: 'required', type: 'uint32' },
    ],
  },
  {
    type: 'error',
    name: 'WinnerCountMismatch',
    inputs: [
      { name: 'expected', type: 'uint256' },
      { name: 'actual', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'WinnerNotRegistered', inputs: [{ name: 'winner', type: 'address' }] },
  { type: 'error', name: 'DuplicateWinner', inputs: [{ name: 'winner', type: 'address' }] },
  { type: 'error', name: 'CancelNotAllowed', inputs: [{ name: 'tournamentId', type: 'uint256' }] },
  {
    type: 'error',
    name: 'NothingToClaim',
    inputs: [
      { name: 'tournamentId', type: 'uint256' },
      { name: 'account', type: 'address' },
    ],
  },
  { type: 'error', name: 'InvalidPayoutSplit', inputs: [{ name: 'sumBps', type: 'uint256' }] },
  { type: 'error', name: 'InvalidParams', inputs: [{ name: 'field', type: 'string' }] },
  {
    type: 'error',
    name: 'TransferFailed',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
] as const
