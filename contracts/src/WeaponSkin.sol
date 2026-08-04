// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {IWeaponSkin} from "./interfaces/IWeaponSkin.sol";
import {IGameAssetRegistry} from "./interfaces/IGameAssetRegistry.sol";

/// @title WeaponSkin
/// @notice 武器皮肤 NFT。玩家真正持有的资产。
/// @dev 设计约束：
///      1. 本合约**不可升级**。持有所有权的合约一旦可升级，一次升级就能加进
///         adminBurn，"我们无法收回你的资产"就成了假话。因此保持极简，业务
///         逻辑全部外移到 RewardDistributor / GameAssetRegistry。
///      2. 继承 ERC721Enumerable 是个 hackathon 取舍：实测每次铸造多花约 80k gas、
///         每次转移多花约 26k（见 test/EnumerableCost.t.sol），换来 web 端和游戏
///         后端可以直接 tokensOfOwner() 读库存，整个索引服务可以不做。
///         上主网前若 gas 成为瓶颈，再改为自建 indexer。
contract WeaponSkin is IWeaponSkin, ERC721, ERC721Enumerable, ERC2981, AccessControl {
    using Strings for uint256;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant URI_ADMIN_ROLE = keccak256("URI_ADMIN_ROLE");

    /// @notice 磨损上界（万分比），10000 = 1.0
    uint16 public constant MAX_WEAR = 10_000;

    IGameAssetRegistry public immutable registry;

    string private _baseTokenURI;
    mapping(uint256 tokenId => SkinData) private _skinData;

    constructor(
        string memory name_,
        string memory symbol_,
        string memory baseTokenURI_,
        address registry_,
        address admin_,
        address royaltyReceiver_,
        uint96 royaltyFeeNumerator_
    ) ERC721(name_, symbol_) {
        if (registry_ == address(0) || admin_ == address(0) || royaltyReceiver_ == address(0)) {
            revert ZeroAddress();
        }

        registry = IGameAssetRegistry(registry_);
        _baseTokenURI = baseTokenURI_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(URI_ADMIN_ROLE, admin_);
        _setDefaultRoyalty(royaltyReceiver_, royaltyFeeNumerator_);
    }

    // --------------------------------------------------------------------
    // 铸造与销毁
    // --------------------------------------------------------------------

    /// @inheritdoc IWeaponSkin
    function mint(address to, uint32 skinDefId, uint16 wear, uint32 seasonId)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256 tokenId)
    {
        if (to == address(0)) revert ZeroAddress();
        if (wear > MAX_WEAR) revert WearOutOfRange(wear);

        // 供应上限在 registry 中原子强制。款式未定义或已售罄会在这里 revert。
        uint32 serial = registry.consumeSupply(skinDefId);

        tokenId = encodeTokenId(skinDefId, serial);

        _skinData[tokenId] = SkinData({
            skinDefId: skinDefId,
            serial: serial,
            wear: wear,
            seasonId: seasonId,
            mintedAt: uint64(block.timestamp)
        });

        _safeMint(to, tokenId);

        emit SkinMinted(tokenId, to, skinDefId, serial, wear, seasonId);
    }

    /// @inheritdoc IWeaponSkin
    function burn(uint256 tokenId) external {
        if (_ownerOf(tokenId) != msg.sender) revert NotTokenOwner(tokenId, msg.sender);

        // 注意：不回退 registry.minted。序号永不复用，销毁只会让该款式更稀缺。
        delete _skinData[tokenId];
        _burn(tokenId);
    }

    // --------------------------------------------------------------------
    // 查询
    // --------------------------------------------------------------------

    /// @inheritdoc IWeaponSkin
    function skinData(uint256 tokenId) external view returns (SkinData memory) {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist(tokenId);
        return _skinData[tokenId];
    }

    /// @inheritdoc IWeaponSkin
    function tokensOfOwner(address owner) external view returns (uint256[] memory tokenIds) {
        uint256 count = balanceOf(owner);
        tokenIds = new uint256[](count);
        for (uint256 i = 0; i < count; ++i) {
            tokenIds[i] = tokenOfOwnerByIndex(owner, i);
        }
    }

    /// @notice tokenId = (skinDefId << 32) | serial
    /// @dev 让 tokenId 自带语义：索引器、前端、客服都能直接看出是哪款的第几件，
    ///      代价是 tokenId 不连续。可读性的价值大于连续性。
    function encodeTokenId(uint32 skinDefId, uint32 serial) public pure returns (uint256) {
        return (uint256(skinDefId) << 32) | uint256(serial);
    }

    /// @inheritdoc IWeaponSkin
    function decodeTokenId(uint256 tokenId) external pure returns (uint32 skinDefId, uint32 serial) {
        // 截断是 decode 的本意：encodeTokenId 只写入低 64 位。
        // forge-lint: disable-next-line(unsafe-typecast)
        skinDefId = uint32(tokenId >> 32);
        // forge-lint: disable-next-line(unsafe-typecast)
        serial = uint32(tokenId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist(tokenId);
        string memory base = _baseTokenURI;
        return bytes(base).length == 0 ? "" : string.concat(base, tokenId.toString());
    }

    // --------------------------------------------------------------------
    // 管理
    // --------------------------------------------------------------------

    function setBaseURI(string calldata newBaseTokenURI) external onlyRole(URI_ADMIN_ROLE) {
        emit BaseURIUpdated(_baseTokenURI, newBaseTokenURI);
        _baseTokenURI = newBaseTokenURI;
    }

    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setDefaultRoyalty(receiver, feeNumerator);
    }

    // --------------------------------------------------------------------
    // 多继承消歧
    // --------------------------------------------------------------------

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value) internal override(ERC721, ERC721Enumerable) {
        super._increaseBalance(account, value);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable, ERC2981, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
