// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IAutomationRegistryConsumer} from "@chainlink/contracts/src/v0.8/automation/interfaces/IAutomationRegistryConsumer.sol";
import {LinkTokenInterface} from "@chainlink/contracts/src/v0.8/shared/interfaces/LinkTokenInterface.sol";
import {IUpkeepBalanceMonitor} from "../interfaces/common/IUpkeepBalanceMonitor.sol";
import {IUpkeepBalanceMonitorV2_1} from "../interfaces/v2_1/IUpkeepBalanceMonitorV2_1.sol";

contract UpkeepBalanceMonitorV2_1 is IUpkeepBalanceMonitorV2_1, Ownable, AccessControl, Pausable {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.UintSet;

    /// @inheritdoc IUpkeepBalanceMonitorV2_1
    address public immutable override keeperRegistry;
    /// @inheritdoc IUpkeepBalanceMonitor
    address public immutable override linkToken;
    /// @inheritdoc IUpkeepBalanceMonitor
    address public override forwarderAddress;

    EnumerableSet.UintSet private _watchList;

    Config private _config;

    bytes32 private constant WATCHLIST_MANAGER_ROLE = keccak256("WATCHLIST_MANAGER_ROLE");

    modifier onlyOwnerOrWatchlistManager() {
        if (owner() != msg.sender && !hasRole(WATCHLIST_MANAGER_ROLE, msg.sender)) revert OnlyWatchlistManagerOrOwner();
        _;
    }

    constructor(address _linkToken, address _keeperRegistry, Config memory config) {
        linkToken = _linkToken;
        keeperRegistry = _keeperRegistry;
        setConfig(config);
    }

    /// @inheritdoc IUpkeepBalanceMonitor
    function getUnderfundedUpkeeps() public view override returns (uint256[] memory, uint96[] memory) {
        Config memory config = _config;
        uint256[] memory needsFunding = new uint256[](config.maxBatchSize);
        uint96[] memory topUpAmounts = new uint96[](config.maxBatchSize);

        uint256 startIndex = uint256(keccak256(abi.encodePacked(block.number))) % _watchList.length();
        uint256 iterationLimit = _watchList.length() < config.maxIterations
            ? _watchList.length()
            : config.maxIterations;

        uint256 availableFunds = LinkTokenInterface(linkToken).balanceOf(address(this));
        uint256 count;

        for (uint256 i = 0; i < iterationLimit; i++) {
            uint256 currentIndex = (startIndex + i) % _watchList.length();
            uint256 upkeepId = _watchList.at(currentIndex);

            uint96 upkeepBalance = IAutomationRegistryConsumer(keeperRegistry).getBalance(upkeepId);
            uint96 minBalance = IAutomationRegistryConsumer(keeperRegistry).getMinBalance(upkeepId);
            uint96 topUpThreshold = (minBalance * config.minPercentage) / 100;
            uint96 targetBalance = (minBalance * config.targetPercentage) / 100;

            if (upkeepBalance < targetBalance) {
                uint96 topUpAmount = targetBalance - upkeepBalance;

                if (topUpAmount > config.maxTopUpAmount) {
                    topUpAmount = config.maxTopUpAmount;
                }
                if (upkeepBalance <= topUpThreshold && availableFunds >= topUpAmount) {
                    needsFunding[count] = upkeepId;
                    topUpAmounts[count] = topUpAmount;
                    count++;
                    availableFunds -= topUpAmount;
                }
            }
            if (count == config.maxBatchSize) {
                break;
            }
        }
        if (count < config.maxBatchSize) {
            assembly {
                mstore(needsFunding, count)
                mstore(topUpAmounts, count)
            }
        }
        return (needsFunding, topUpAmounts);
    }

    /// @inheritdoc IUpkeepBalanceMonitor
    function topUp(uint256[] memory _upkeepIds, uint96[] memory _topUpAmounts) public override whenNotPaused {
        if (msg.sender != forwarderAddress && msg.sender != owner()) revert OnlyForwarderOrOwner();

        uint256 upkeepIdsLength = _upkeepIds.length;
        if (upkeepIdsLength != _topUpAmounts.length) revert InvalidTopUpData();
        for (uint256 i = 0; i < upkeepIdsLength; i++) {
            try
                LinkTokenInterface(linkToken).transferAndCall(
                    keeperRegistry,
                    _topUpAmounts[i],
                    abi.encode(_upkeepIds[i])
                )
            returns (bool success) {
                if (success) {
                    emit TopUpSucceeded(_upkeepIds[i], _topUpAmounts[i]);
                    continue;
                }
            } catch {}
            emit TopUpFailed(_upkeepIds[i]);
        }
    }

    /// @inheritdoc IUpkeepBalanceMonitor
    function checkUpkeep(bytes calldata) external view override returns (bool upkeepNeeded, bytes memory performData) {
        (uint256[] memory needsFunding, uint96[] memory topUpAmounts) = getUnderfundedUpkeeps();
        upkeepNeeded = needsFunding.length > 0;
        if (upkeepNeeded) {
            performData = abi.encode(needsFunding, topUpAmounts);
        }
        return (upkeepNeeded, performData);
    }

    /// @inheritdoc IUpkeepBalanceMonitor
    function performUpkeep(bytes calldata _performData) external override {
        (uint256[] memory upkeepIds, uint96[] memory topUpAmounts) = abi.decode(_performData, (uint256[], uint96[]));
        topUp(upkeepIds, topUpAmounts);
    }

    /// @inheritdoc IUpkeepBalanceMonitor
    function withdraw(uint256 _amount, address _payee) external override onlyOwner {
        if (_payee == address(0)) revert AddressZeroNotAllowed();
        IERC20(linkToken).safeTransfer(_payee, _amount);
        emit FundsWithdrawn(_amount, _payee);
    }

    /// @inheritdoc IUpkeepBalanceMonitor
    function pause() external override onlyOwner {
        _pause();
    }

    /// @inheritdoc IUpkeepBalanceMonitor
    function unpause() external override onlyOwner {
        _unpause();
    }

    /// @inheritdoc IUpkeepBalanceMonitor
    function setTrustedForwarder(address _trustedForwarder) external override onlyOwner {
        if (_trustedForwarder == address(0)) {
            revert AddressZeroNotAllowed();
        }
        forwarderAddress = _trustedForwarder;
        emit ForwarderSet(_trustedForwarder);
    }

    /// @inheritdoc IUpkeepBalanceMonitor
    function grantWatchlistManagerRole(address _manager) external override onlyOwner {
        _grantRole(WATCHLIST_MANAGER_ROLE, _manager);
    }

    /// @inheritdoc IUpkeepBalanceMonitor
    function revokeWatchlistManagerRole(address _manager) external override onlyOwner {
        _revokeRole(WATCHLIST_MANAGER_ROLE, _manager);
    }

    /// @inheritdoc IUpkeepBalanceMonitor
    function addToWatchList(uint256 _upkeepId) public override onlyOwnerOrWatchlistManager {
        if (_upkeepId == 0) revert ZeroIdNotAllowed();
        _watchList.add(_upkeepId);
        emit WatchListUpdated(_upkeepId, true);
    }

    /// @inheritdoc IUpkeepBalanceMonitor
    function addMultipleToWatchList(uint256[] memory _upkeepIds) external override onlyOwner {
        uint256 length = _upkeepIds.length;
        for (uint256 i = 0; i < length; i++) {
            addToWatchList(_upkeepIds[i]);
        }
    }

    /// @inheritdoc IUpkeepBalanceMonitor
    function removeFromWatchList(uint256 _upkeepId) public override onlyOwnerOrWatchlistManager {
        _watchList.remove(_upkeepId);
        emit WatchListUpdated(_upkeepId, false);
    }

    /// @inheritdoc IUpkeepBalanceMonitor
    function removeMultipleFromWatchList(uint256[] memory _upkeepIds) external override onlyOwner {
        uint256 length = _upkeepIds.length;
        for (uint256 i = 0; i < length; i++) {
            removeFromWatchList(_upkeepIds[i]);
        }
    }

    /// @inheritdoc IUpkeepBalanceMonitor
    function setConfig(Config memory config) public override onlyOwner {
        if (
            config.maxBatchSize == 0 ||
            config.minPercentage < 100 ||
            config.targetPercentage <= config.minPercentage ||
            config.maxTopUpAmount == 0 ||
            config.maxIterations == 0
        ) {
            revert InvalidConfig();
        }
        _config = config;
        emit ConfigSet(config);
    }

    /// @inheritdoc IUpkeepBalanceMonitor
    function getConfig() external view override returns (Config memory) {
        return _config;
    }

    /// @inheritdoc IUpkeepBalanceMonitor
    function getWatchList() external view override returns (uint256[] memory) {
        return _watchList.values();
    }

    /// @inheritdoc IUpkeepBalanceMonitor
    function getWatchListLength() external view override returns (uint256) {
        return _watchList.length();
    }

    /// @inheritdoc IUpkeepBalanceMonitor
    function getWatchListItem(uint256 _index) external view override returns (uint256) {
        return _watchList.at(_index);
    }
}
