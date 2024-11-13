// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {ILogAutomation, Log} from "@chainlink/contracts/src/v0.8/automation/interfaces/ILogAutomation.sol";
import {AutomationCompatibleInterface} from "@chainlink/contracts/src/v0.8/automation/interfaces/AutomationCompatibleInterface.sol";
import {IKeeperRegistryMaster} from "@chainlink/contracts/src/v0.8/automation/interfaces/v2_1/IKeeperRegistryMaster.sol";
import {LinkTokenInterface} from "@chainlink/contracts/src/v0.8/shared/interfaces/LinkTokenInterface.sol";
import {CronUpkeep} from "@chainlink/contracts/src/v0.8/automation/upkeeps/CronUpkeep.sol";
import {Spec, Cron} from "@chainlink/contracts/src/v0.8/automation/libraries/external/Cron.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IAutomationRegistrar, RegistrationParams} from "./interfaces/IAutomationRegistrar.sol";
import {IGaugeUpkeepManager} from "./interfaces/IGaugeUpkeepManager.sol";

contract GaugeUpkeepManager is IGaugeUpkeepManager, ILogAutomation, AutomationCompatibleInterface, Ownable {
    /// @inheritdoc IGaugeUpkeepManager
    address public override immutable linkToken;
    /// @inheritdoc IGaugeUpkeepManager
    address public override immutable keeperRegistry;
    /// @inheritdoc IGaugeUpkeepManager
    address public override immutable automationRegistrar;
    /// @inheritdoc IGaugeUpkeepManager
    address public override immutable automationCronDelegate;
    /// @inheritdoc IGaugeUpkeepManager
    address public override immutable voter;
    
    /// @inheritdoc IGaugeUpkeepManager
    address public override trustedForwarder;
    /// @inheritdoc IGaugeUpkeepManager
    uint96 public override newUpkeepFundAmount;
    /// @inheritdoc IGaugeUpkeepManager
    uint32 public override newUpkeepGasLimit;

    /// @inheritdoc IGaugeUpkeepManager
    mapping(address => uint256) public override gaugeUpkeepId;
    /// @inheritdoc IGaugeUpkeepManager
    address[] public override cancelledGaugeUpkeeps;
    /// @inheritdoc IGaugeUpkeepManager
    mapping(address => uint256) public override cancelledUpkeepBlockNumber;

    uint8 private constant CONDITIONAL_TRIGGER_TYPE = 0;
    uint256 private constant CRON_UPKEEP_MAX_JOBS = 1;
    uint256 private constant CANCELLATION_DELAY_BLOCKS = 100;
    string private constant UPKEEP_NAME = "cron upkeep";
    string private constant CRON_EXPRESSION = "0 0 * * 3";
    string private constant DISTRIBUTE_FUNCTION = "distribute(address)";
    
    bytes32 private constant GAUGE_CREATED_SIGNATURE = 0xef9f7d1ffff3b249c6b9bf2528499e935f7d96bb6d6ec4e7da504d1d3c6279e1;
    bytes32 private constant GAUGE_KILLED_SIGNATURE = 0x04a5d3f5d80d22d9345acc80618f4a4e7e663cf9e1aed23b57d975acec002ba7;
    bytes32 private constant GAUGE_REVIVED_SIGNATURE = 0xed18e9faa3dccfd8aa45f69c4de40546b2ca9cccc4538a2323531656516db1aa;

    enum PerformAction { REGISTER_UPKEEP, CANCEL_UPKEEP, WITHDRAW_UPKEEP_BALANCE }

    error InvalidPerformAction();
    error AutoApproveDisabled();
    error UnauthorizedSender();

    constructor(
        address _linkToken,
        address _keeperRegistry,
        address _automationRegistrar,
        address _automationCronDelegate,
        address _voter,
        uint96 _newUpkeepFundAmount,
        uint32 _newUpkeepGasLimit
    ) {
        linkToken = _linkToken;
        keeperRegistry = _keeperRegistry;
        automationRegistrar = _automationRegistrar;
        automationCronDelegate = _automationCronDelegate;
        voter = _voter;
        newUpkeepFundAmount = _newUpkeepFundAmount;
        newUpkeepGasLimit = _newUpkeepGasLimit;
    }

    /// @inheritdoc ILogAutomation
    /// @notice Called by the automation DON when a new log is emitted by the target contract
    /// @dev This function is called by the automation DON to check if any action is needed
    /// @return upkeepNeeded True if any action is needed according to the log
    /// @return performData Encoded action and data passed to performUpkeep if upkeepNeeded is true
    function checkLog(
        Log calldata log,
        bytes memory
    ) external view override returns (bool upkeepNeeded, bytes memory performData) {
        address gauge;
        bytes32 eventSignature = log.topics[0];
        if (eventSignature == GAUGE_CREATED_SIGNATURE) {
            gauge = _extractGaugeFromCreatedLog(log);
            if (gaugeUpkeepId[gauge] == 0) {
                return (true, abi.encode(PerformAction.REGISTER_UPKEEP, gauge));
            }
        } else if (eventSignature == GAUGE_KILLED_SIGNATURE) {
            gauge = _bytes32ToAddress(log.topics[1]);
            if (gaugeUpkeepId[gauge] != 0) {
                return (true, abi.encode(PerformAction.CANCEL_UPKEEP, gauge));
            }
        } else if (eventSignature == GAUGE_REVIVED_SIGNATURE) {
            gauge = _bytes32ToAddress(log.topics[1]);
            if (gaugeUpkeepId[gauge] == 0) {
                return (true, abi.encode(PerformAction.REGISTER_UPKEEP, gauge));
            }
        }
    }

    /// @inheritdoc AutomationCompatibleInterface
    /// @notice Check if any cancelled gauge upkeeps are ready to be withdrawn
    /// @dev This function is called by the automation DON to check if any upkeeps are needed
    /// @dev Upkeep balance can be withdrawn after a delay of certain blocks
    /// @return upkeepNeeded True if any cancelled gauge upkeeps are ready to be withdrawn
    /// @return performData Encoded action and data passed to performUpkeep if upkeepNeeded is true
    function checkUpkeep(bytes calldata) external view override returns (bool upkeepNeeded, bytes memory performData) {
        for (uint256 i = 0; i < cancelledGaugeUpkeeps.length; i++) {
            address gauge = cancelledGaugeUpkeeps[i];
            if (block.number - cancelledUpkeepBlockNumber[gauge] >= CANCELLATION_DELAY_BLOCKS) {
                return (true, abi.encode(PerformAction.WITHDRAW_UPKEEP_BALANCE, gauge));
            }
        }
    }

    /// @inheritdoc AutomationCompatibleInterface
    /// @notice Perform the upkeep action according to the performData passed from checkUpkeep/checkLog
    /// @dev This function is called by the automation network to perform the upkeep action
    function performUpkeep(bytes calldata performData) external override(ILogAutomation, AutomationCompatibleInterface) {
        if (msg.sender != trustedForwarder) {
            revert UnauthorizedSender();
        }
        (PerformAction action, address gauge) = abi.decode(performData, (PerformAction, address));
        if (action == PerformAction.REGISTER_UPKEEP) {
            _registerGaugeUpkeep(gauge);
        } else if (action == PerformAction.CANCEL_UPKEEP) {
            _cancelGaugeUpkeep(gauge);
        } else if (action == PerformAction.WITHDRAW_UPKEEP_BALANCE) {
            _withdrawGaugeUpkeep(gauge);
            _removeGaugeUpkeep(gauge);
        } else {
            revert InvalidPerformAction();
        }
    }

    function _registerGaugeUpkeep(address gauge) internal returns (uint256 upkeepId) {
        bytes memory job = _encodeCronJob(
            voter,
            abi.encodeWithSignature(DISTRIBUTE_FUNCTION, gauge),
            CRON_EXPRESSION
        );
        CronUpkeep cronUpkeep = new CronUpkeep(
            address(this),
            automationCronDelegate,
            CRON_UPKEEP_MAX_JOBS,
            job
        );
        RegistrationParams memory params = RegistrationParams({
            name: UPKEEP_NAME,
            encryptedEmail: "",
            upkeepContract: address(cronUpkeep),
            gasLimit: newUpkeepGasLimit,
            adminAddress: address(this),
            triggerType: CONDITIONAL_TRIGGER_TYPE,
            checkData: "",
            triggerConfig: "",
            offchainConfig: "",
            amount: newUpkeepFundAmount
        });
        upkeepId = _registerUpkeep(params);
        gaugeUpkeepId[gauge] = upkeepId;
        emit GaugeUpkeepRegistered(gauge, upkeepId);
    }

    function _registerUpkeep(RegistrationParams memory params) internal returns (uint256) {
        LinkTokenInterface(linkToken).approve(automationRegistrar, params.amount);
        uint256 upkeepID = IAutomationRegistrar(automationRegistrar).registerUpkeep(params);
        if (upkeepID != 0) {
            return upkeepID;
        } else {
            revert AutoApproveDisabled();
        }
    }

    function _cancelGaugeUpkeep(address gauge) internal {
        uint256 upkeepId = gaugeUpkeepId[gauge];
        IKeeperRegistryMaster(keeperRegistry).cancelUpkeep(upkeepId);
        cancelledGaugeUpkeeps.push(gauge);
        cancelledUpkeepBlockNumber[gauge] = block.number;
        emit GaugeUpkeepCancelled(gauge, upkeepId);
    }

    function _withdrawGaugeUpkeep(address gauge) internal {
        uint256 upkeepId = gaugeUpkeepId[gauge];
        IKeeperRegistryMaster(keeperRegistry).withdrawFunds(upkeepId, address(this));
        emit GaugeUpkeepWithdrawn(gauge, upkeepId);
    }

    function _removeGaugeUpkeep(address gauge) internal {
        uint256 index;
        for (uint256 i = 0; i < cancelledGaugeUpkeeps.length; i++) {
            if (cancelledGaugeUpkeeps[i] == gauge) {
                index = i;
                break;
            }
        }
        cancelledGaugeUpkeeps[index] = cancelledGaugeUpkeeps[cancelledGaugeUpkeeps.length - 1];
        cancelledGaugeUpkeeps.pop();
        delete cancelledUpkeepBlockNumber[gauge];
        delete gaugeUpkeepId[gauge];
    }

    function _encodeCronJob(
        address target,
        bytes memory handler,
        string memory cronString
    ) internal pure returns (bytes memory) {
        Spec memory spec = Cron.toSpec(cronString);
        return abi.encode(target, handler, spec);
    }

    function _extractGaugeFromCreatedLog(Log memory log) internal pure returns (address gauge) {
        (,,,gauge,) = abi.decode(log.data, (address, address, address, address, address));
    }

    function _bytes32ToAddress(bytes32 _address) internal pure returns (address) {
        return address(uint160(uint256(_address)));
    }

    /// @inheritdoc IGaugeUpkeepManager
    function withdrawLinkBalance() external override onlyOwner {
        LinkTokenInterface(linkToken).transfer(owner(), LinkTokenInterface(linkToken).balanceOf(address(this)));
    }

    /// @inheritdoc IGaugeUpkeepManager
    function transferUpkeepAdmin(uint256 upkeepId, address newAdmin) external override onlyOwner {
        IKeeperRegistryMaster(keeperRegistry).transferUpkeepAdmin(upkeepId, newAdmin);
    }

    /// @inheritdoc IGaugeUpkeepManager
    function setNewUpkeepGasLimit(uint32 _newUpkeepGasLimit) external override onlyOwner {
        newUpkeepGasLimit = _newUpkeepGasLimit;
    }

    /// @inheritdoc IGaugeUpkeepManager
    function setNewUpkeepFundAmount(uint96 _newUpkeepFundAmount) external override onlyOwner {
        newUpkeepFundAmount = _newUpkeepFundAmount;
    }

    /// @inheritdoc IGaugeUpkeepManager
    function setTrustedForwarder(address _trustedForwarder) external override onlyOwner {
        trustedForwarder = _trustedForwarder;
    }
}
