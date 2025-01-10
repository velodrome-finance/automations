// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {IAutomationRegistryConsumer} from "@chainlink/contracts/src/v0.8/automation/interfaces/IAutomationRegistryConsumer.sol";
import {LinkTokenInterface} from "@chainlink/contracts/src/v0.8/shared/interfaces/LinkTokenInterface.sol";
import {IUpkeepBalanceMonitor} from "./interfaces/IUpkeepBalanceMonitor.sol";
import {IGaugeUpkeepManager} from "./interfaces/IGaugeUpkeepManager.sol";

contract UpkeepBalanceMonitor is IUpkeepBalanceMonitor, Ownable, Pausable {
    /// @inheritdoc IUpkeepBalanceMonitor
    address public immutable override gaugeUpkeepManager;
    /// @inheritdoc IUpkeepBalanceMonitor
    address public immutable override keeperRegistry;
    /// @inheritdoc IUpkeepBalanceMonitor
    address public immutable override linkToken;

    /// @inheritdoc IUpkeepBalanceMonitor
    address public override forwarderAddress;

    Config private _config;

    constructor(address _gaugeUpkeepManager, Config memory config) {
        gaugeUpkeepManager = _gaugeUpkeepManager;
        linkToken = IGaugeUpkeepManager(_gaugeUpkeepManager).linkToken();
        keeperRegistry = IGaugeUpkeepManager(_gaugeUpkeepManager).keeperRegistry();
        setConfig(config);
    }

    /// @inheritdoc IUpkeepBalanceMonitor
    function getUnderfundedUpkeeps() public view override returns (uint256[] memory, uint96[] memory) {
        Config memory config = _config;
        uint256[] memory needsFunding = new uint256[](config.maxBatchSize);
        uint96[] memory topUpAmounts = new uint96[](config.maxBatchSize);

        uint256 count;
        uint256 availableFunds = LinkTokenInterface(linkToken).balanceOf(address(this));
        uint256 upkeepsCount = IGaugeUpkeepManager(gaugeUpkeepManager).activeUpkeepsCount();

        for (uint256 i = 0; i < upkeepsCount; i++) {
            uint256 upkeepId = IGaugeUpkeepManager(gaugeUpkeepManager).activeUpkeepIds(i);
            uint96 upkeepBalance = IAutomationRegistryConsumer(keeperRegistry).getBalance(upkeepId);
            uint96 minBalance = IAutomationRegistryConsumer(keeperRegistry).getMinBalance(upkeepId);
            uint96 topUpThreshold = (minBalance * config.minPercentage) / 100;
            uint96 topUpAmount = ((minBalance * config.targetPercentage) / 100) - upkeepBalance;

            if (topUpAmount > config.maxTopUpAmount) {
                topUpAmount = config.maxTopUpAmount;
            }
            if (upkeepBalance <= topUpThreshold && availableFunds >= topUpAmount) {
                needsFunding[count] = upkeepId;
                topUpAmounts[count] = topUpAmount;
                count++;
                availableFunds -= topUpAmount;
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
        LinkTokenInterface(linkToken).transfer(_payee, _amount);
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
        forwarderAddress = _trustedForwarder;
        emit ForwarderSet(_trustedForwarder);
    }

    /// @inheritdoc IUpkeepBalanceMonitor
    function setConfig(Config memory config) public override onlyOwner {
        if (
            config.maxBatchSize == 0 ||
            config.minPercentage < 100 ||
            config.targetPercentage <= config.minPercentage ||
            config.maxTopUpAmount == 0
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
}
