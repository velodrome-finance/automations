// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IKeeperRegistryMaster} from "@chainlink/contracts/src/v0.8/automation/interfaces/v2_1/IKeeperRegistryMaster.sol";
import {IAutomationRegistrarV2_1} from "../../interfaces/v2_1/IAutomationRegistrarV2_1.sol";
import {ITokenUpkeepManagerV2_1} from "../interfaces/v2_1/ITokenUpkeepManagerV2_1.sol";
import {IUpkeepBalanceMonitor} from "../../interfaces/IUpkeepBalanceMonitor.sol";
import {TokenUpkeepManager} from "../common/TokenUpkeepManager.sol";
import {TokenUpkeep} from "../TokenUpkeep.sol";

contract TokenUpkeepManagerV2_1 is TokenUpkeepManager, ITokenUpkeepManagerV2_1 {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.UintSet;

    /// @inheritdoc ITokenUpkeepManagerV2_1
    address public immutable override keeperRegistry;

    constructor(
        address _linkToken,
        address _keeperRegistry,
        address _automationRegistrar,
        address _voter,
        address _pricesOracle,
        address _upkeepBalanceMonitor,
        uint96 _newUpkeepFundAmount,
        uint32 _newUpkeepGasLimit
    )
        TokenUpkeepManager(
            _linkToken,
            _automationRegistrar,
            _voter,
            _pricesOracle,
            _upkeepBalanceMonitor,
            _newUpkeepFundAmount,
            _newUpkeepGasLimit
        )
    {
        keeperRegistry = _keeperRegistry;
    }

    function _registerTokenUpkeep() internal override {
        uint256 startIndex = _getNextUpkeepStartIndex(upkeepIds.length);
        uint256 endIndex = startIndex + TOKENS_PER_UPKEEP;
        address _tokenUpkeep = address(new TokenUpkeep(startIndex, endIndex));
        isTokenUpkeep[_tokenUpkeep] = true;
        IAutomationRegistrarV2_1.RegistrationParams memory params = IAutomationRegistrarV2_1.RegistrationParams({
            name: UPKEEP_NAME,
            encryptedEmail: "",
            upkeepContract: _tokenUpkeep,
            gasLimit: newUpkeepGasLimit,
            adminAddress: address(this),
            triggerType: CONDITIONAL_TRIGGER_TYPE,
            checkData: "",
            triggerConfig: "",
            offchainConfig: "",
            amount: newUpkeepFundAmount
        });
        uint256 upkeepId = _registerUpkeep(params);
        upkeepIds.push(upkeepId);
        tokenUpkeep[upkeepId] = _tokenUpkeep;
        address forwarder = IKeeperRegistryMaster(keeperRegistry).getForwarder(upkeepId);
        TokenUpkeep(_tokenUpkeep).setTrustedForwarder(forwarder);
        IUpkeepBalanceMonitor(upkeepBalanceMonitor).addToWatchList(upkeepId);
        emit TokenUpkeepRegistered(_tokenUpkeep, upkeepId, startIndex, endIndex);
    }

    function _registerUpkeep(IAutomationRegistrarV2_1.RegistrationParams memory _params) internal returns (uint256) {
        IERC20(linkToken).safeIncreaseAllowance(automationRegistrar, _params.amount);
        uint256 upkeepID = IAutomationRegistrarV2_1(automationRegistrar).registerUpkeep(_params);
        if (upkeepID != 0) {
            return upkeepID;
        } else {
            revert AutoApproveDisabled();
        }
    }

    function _cancelTokenUpkeep(uint256 _upkeepId) internal override {
        upkeepIds.pop();
        delete isTokenUpkeep[tokenUpkeep[_upkeepId]];
        delete tokenUpkeep[_upkeepId];
        _cancelledUpkeepIds.add(_upkeepId);
        IUpkeepBalanceMonitor(upkeepBalanceMonitor).removeFromWatchList(_upkeepId);
        IKeeperRegistryMaster(keeperRegistry).cancelUpkeep(_upkeepId);
        emit TokenUpkeepCancelled(_upkeepId);
    }

    function _withdrawUpkeep(uint256 _upkeepId) internal override {
        _cancelledUpkeepIds.remove(_upkeepId);
        IKeeperRegistryMaster(keeperRegistry).withdrawFunds(_upkeepId, address(this));
        emit TokenUpkeepWithdrawn(_upkeepId);
    }
}
