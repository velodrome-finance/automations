// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IAutomationRegistryMaster2_3} from "@chainlink/contracts/src/v0.8/automation/interfaces/v2_3/IAutomationRegistryMaster2_3.sol";
import {IAutomationRegistrarV2_3} from "../../interfaces/v2_3/IAutomationRegistrarV2_3.sol";
import {IGaugeUpkeepManagerV2_3} from "../interfaces/v2_3/IGaugeUpkeepManagerV2_3.sol";
import {IUpkeepBalanceMonitor} from "../../interfaces/IUpkeepBalanceMonitor.sol";
import {GaugeUpkeepManager} from "../common/GaugeUpkeepManager.sol";
import {GaugeUpkeep} from "../GaugeUpkeep.sol";

contract GaugeUpkeepManagerV2_3 is GaugeUpkeepManager, IGaugeUpkeepManagerV2_3 {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.UintSet;

    /// @inheritdoc IGaugeUpkeepManagerV2_3
    address payable public immutable override keeperRegistry;

    constructor(
        address _linkToken,
        address payable _keeperRegistry,
        address _automationRegistrar,
        address _upkeepBalanceMonitor,
        address _voter,
        uint96 _newUpkeepFundAmount,
        uint32 _newUpkeepGasLimit,
        uint8 _batchSize,
        address[] memory _excludedGaugeFactories
    )
        GaugeUpkeepManager(
            _linkToken,
            _automationRegistrar,
            _upkeepBalanceMonitor,
            _voter,
            _newUpkeepFundAmount,
            _newUpkeepGasLimit,
            _batchSize,
            _excludedGaugeFactories
        )
    {
        keeperRegistry = _keeperRegistry;
    }

    function _registerGaugeUpkeep() internal override {
        uint256 startIndex = _getNextUpkeepStartIndex(upkeepIds.length);
        uint256 endIndex = startIndex + GAUGES_PER_UPKEEP;
        address gaugeUpkeep = address(new GaugeUpkeep(voter, startIndex, endIndex));
        IAutomationRegistrarV2_3.RegistrationParams memory params = IAutomationRegistrarV2_3.RegistrationParams({
            name: UPKEEP_NAME,
            encryptedEmail: "",
            upkeepContract: gaugeUpkeep,
            gasLimit: newUpkeepGasLimit,
            adminAddress: address(this),
            triggerType: CONDITIONAL_TRIGGER_TYPE,
            checkData: "",
            triggerConfig: "",
            offchainConfig: "",
            amount: newUpkeepFundAmount,
            billingToken: IERC20(linkToken)
        });
        uint256 upkeepId = _registerUpkeep(params);
        upkeepIds.push(upkeepId);
        IUpkeepBalanceMonitor(upkeepBalanceMonitor).addToWatchList(upkeepId);
        emit GaugeUpkeepRegistered(gaugeUpkeep, upkeepId, startIndex, endIndex);
    }

    function _registerUpkeep(IAutomationRegistrarV2_3.RegistrationParams memory _params) internal returns (uint256) {
        IERC20(linkToken).safeIncreaseAllowance(automationRegistrar, _params.amount);
        uint256 upkeepID = IAutomationRegistrarV2_3(automationRegistrar).registerUpkeep(_params);
        if (upkeepID != 0) {
            return upkeepID;
        } else {
            revert AutoApproveDisabled();
        }
    }

    function _cancelGaugeUpkeep(uint256 _upkeepId) internal override {
        upkeepIds.pop();
        _cancelledUpkeepIds.add(_upkeepId);
        IUpkeepBalanceMonitor(upkeepBalanceMonitor).removeFromWatchList(_upkeepId);
        IAutomationRegistryMaster2_3(keeperRegistry).cancelUpkeep(_upkeepId);
        emit GaugeUpkeepCancelled(_upkeepId);
    }

    function _withdrawUpkeep(uint256 _upkeepId) internal override {
        _cancelledUpkeepIds.remove(_upkeepId);
        IAutomationRegistryMaster2_3(keeperRegistry).withdrawFunds(_upkeepId, address(this));
        emit GaugeUpkeepWithdrawn(_upkeepId);
    }
}
