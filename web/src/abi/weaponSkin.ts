/**
 * Minimal hand-written ABI fragment for WeaponSkin
 * (contracts/src/WeaponSkin.sol — ERC-721 + ERC721Enumerable + ERC-2981).
 *
 * Signatures copied verbatim from the Solidity sources:
 * - IWeaponSkin.sol: skinData / tokensOfOwner / SkinData struct / errors
 * - ERC721Enumerable: totalSupply / tokenByIndex
 * - ERC721: ownerOf / isApprovedForAll / setApprovalForAll / tokenURI
 * - ERC2981: royaltyInfo
 *
 * Custom errors are included so viem can decode revert reasons.
 */
export const weaponSkinAbi = [
  {
    type: 'function',
    name: 'tokensOfOwner',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: 'tokenIds', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'skinData',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct IWeaponSkin.SkinData',
        components: [
          { name: 'skinDefId', type: 'uint32' },
          { name: 'serial', type: 'uint32' },
          { name: 'wear', type: 'uint16' },
          { name: 'seasonId', type: 'uint32' },
          { name: 'mintedAt', type: 'uint64' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'tokenByIndex',
    stateMutability: 'view',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'isApprovedForAll',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'operator', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'setApprovalForAll',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'royaltyInfo',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'salePrice', type: 'uint256' },
    ],
    outputs: [
      { name: 'receiver', type: 'address' },
      { name: 'royaltyAmount', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'tokenURI',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'event',
    name: 'SkinMinted',
    inputs: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'skinDefId', type: 'uint32', indexed: true },
      { name: 'serial', type: 'uint32', indexed: false },
      { name: 'wear', type: 'uint16', indexed: false },
      { name: 'seasonId', type: 'uint32', indexed: false },
    ],
  },
  { type: 'error', name: 'WearOutOfRange', inputs: [{ name: 'wear', type: 'uint16' }] },
  { type: 'error', name: 'TokenDoesNotExist', inputs: [{ name: 'tokenId', type: 'uint256' }] },
  {
    type: 'error',
    name: 'NotTokenOwner',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'caller', type: 'address' },
    ],
  },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
] as const
