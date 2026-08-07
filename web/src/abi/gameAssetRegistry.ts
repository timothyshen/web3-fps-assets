/**
 * Minimal hand-written ABI fragment for GameAssetRegistry
 * (contracts/src/GameAssetRegistry.sol / interfaces/IGameAssetRegistry.sol).
 *
 * Only the read surface the web app uses, plus custom errors for revert
 * decoding. Struct field order matches SkinDefinition exactly.
 */
export const gameAssetRegistryAbi = [
  {
    type: 'function',
    name: 'getSkin',
    stateMutability: 'view',
    inputs: [{ name: 'skinDefId', type: 'uint32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct IGameAssetRegistry.SkinDefinition',
        components: [
          { name: 'maxSupply', type: 'uint32' },
          { name: 'minted', type: 'uint32' },
          { name: 'rarity', type: 'uint8' },
          { name: 'frozen', type: 'bool' },
          { name: 'exists', type: 'bool' },
          { name: 'contentHash', type: 'bytes32' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'isDefined',
    stateMutability: 'view',
    inputs: [{ name: 'skinDefId', type: 'uint32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'remainingSupply',
    stateMutability: 'view',
    inputs: [{ name: 'skinDefId', type: 'uint32' }],
    outputs: [{ name: '', type: 'uint32' }],
  },
  { type: 'error', name: 'SkinAlreadyDefined', inputs: [{ name: 'skinDefId', type: 'uint32' }] },
  { type: 'error', name: 'SkinNotDefined', inputs: [{ name: 'skinDefId', type: 'uint32' }] },
  { type: 'error', name: 'SkinIsFrozen', inputs: [{ name: 'skinDefId', type: 'uint32' }] },
  {
    type: 'error',
    name: 'SupplyExhausted',
    inputs: [
      { name: 'skinDefId', type: 'uint32' },
      { name: 'maxSupply', type: 'uint32' },
    ],
  },
  { type: 'error', name: 'InvalidMaxSupply', inputs: [{ name: 'requested', type: 'uint32' }] },
  { type: 'error', name: 'NotAuthorizedMinter', inputs: [{ name: 'caller', type: 'address' }] },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
] as const
