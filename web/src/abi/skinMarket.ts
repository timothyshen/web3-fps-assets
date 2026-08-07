/**
 * Minimal hand-written ABI fragment for SkinMarket
 * (contracts/src/SkinMarket.sol / interfaces/ISkinMarket.sol).
 *
 * NOTE — the contract has NO listing enumeration view. What exists:
 *   - getListing(tokenId) -> Listing { seller, price }   (mapping read)
 *   - isActive(tokenId)   -> bool                        (zombie-listing check)
 *   - events Listed / Cancelled / Sold
 * The app enumerates candidate tokenIds via WeaponSkin's ERC721Enumerable
 * (totalSupply + tokenByIndex) and then multicalls getListing — see
 * src/hooks/useMarket.ts for the rationale. The events are included here so
 * revert/receipt decoding and a future getLogs path both work.
 */
export const skinMarketAbi = [
  {
    type: 'function',
    name: 'list',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'price', type: 'uint96' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancel',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'buy',
    stateMutability: 'payable',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getListing',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct ISkinMarket.Listing',
        components: [
          { name: 'seller', type: 'address' },
          { name: 'price', type: 'uint96' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'isActive',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'collection',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'event',
    name: 'Listed',
    inputs: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'seller', type: 'address', indexed: true },
      { name: 'price', type: 'uint96', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Cancelled',
    inputs: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'seller', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'Sold',
    inputs: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'seller', type: 'address', indexed: true },
      { name: 'buyer', type: 'address', indexed: true },
      { name: 'price', type: 'uint96', indexed: false },
      { name: 'royaltyReceiver', type: 'address', indexed: false },
      { name: 'royaltyAmount', type: 'uint256', indexed: false },
    ],
  },
  { type: 'error', name: 'ZeroPrice', inputs: [] },
  { type: 'error', name: 'NotListed', inputs: [{ name: 'tokenId', type: 'uint256' }] },
  {
    type: 'error',
    name: 'NotTokenOwner',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'caller', type: 'address' },
    ],
  },
  { type: 'error', name: 'MarketNotApproved', inputs: [] },
  { type: 'error', name: 'ListingStale', inputs: [{ name: 'tokenId', type: 'uint256' }] },
  {
    type: 'error',
    name: 'InsufficientPayment',
    inputs: [
      { name: 'price', type: 'uint96' },
      { name: 'sent', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRoyalty',
    inputs: [
      { name: 'royaltyAmount', type: 'uint256' },
      { name: 'price', type: 'uint96' },
    ],
  },
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
