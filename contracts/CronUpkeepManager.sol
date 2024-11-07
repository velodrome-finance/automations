// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {ILogAutomation, Log} from "@chainlink/contracts/src/v0.8/automation/interfaces/ILogAutomation.sol";
import {AutomationCompatibleInterface} from "@chainlink/contracts/src/v0.8/automation/interfaces/AutomationCompatibleInterface.sol";
import {LinkTokenInterface} from "@chainlink/contracts/src/v0.8/shared/interfaces/LinkTokenInterface.sol";
import {CronUpkeep} from "@chainlink/contracts/src/v0.8/automation/upkeeps/CronUpkeep.sol";
import {Spec, Cron} from "@chainlink/contracts/src/v0.8/automation/libraries/external/Cron.sol";

struct RegistrationParams {
    string name;
    bytes encryptedEmail;
    address upkeepContract;
    uint32 gasLimit;
    address adminAddress;
    uint8 triggerType;
    bytes checkData;
    bytes triggerConfig;
    bytes offchainConfig;
    uint96 amount;
}

interface AutomationRegistrarInterface {
    function registerUpkeep(RegistrationParams calldata requestParams) external returns (uint256);
}

interface KeeperRegistryInterface {
    function cancelUpkeep(uint256 id) external;
    function withdrawFunds(uint256 id, address to) external;
}

contract CronUpkeepManager is ILogAutomation, AutomationCompatibleInterface {
    address private immutable linkToken;
    address private immutable keeperRegistry;
    address private immutable automationRegistrar;
    address private immutable automationCronDelegate;
    address private immutable veloVoter;

    mapping(address => uint256) private gaugeUpkeepIds;

    address[] private cancelledGaugeUpkeeps;
    mapping(address => uint256) private cancelledUpkeepBlockNumbers;

    uint96 private upkeepFundAmount;
    uint32 private upkeepGasLimit;

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

    event GaugeUpkeepRegistered(address gauge, uint256 upkeepId);
    event GaugeUpkeepCancelled(address gauge, uint256 upkeepId);
    event GaugeUpkeepWithdrawn(address gauge, uint256 upkeepId);

    constructor(
        address _linkToken,
        address _keeperRegistry,
        address _automationRegistrar,
        address _automationCronDelegate,
        address _veloVoter,
        uint96 _upkeepFundAmount,
        uint32 _upkeepGasLimit
    ) {
        linkToken = _linkToken;
        keeperRegistry = _keeperRegistry;
        automationRegistrar = _automationRegistrar;
        automationCronDelegate = _automationCronDelegate;
        veloVoter = _veloVoter;
        upkeepFundAmount = _upkeepFundAmount;
        upkeepGasLimit = _upkeepGasLimit;
    }

    // AUTOMATION INTERFACE

    function checkLog(
        Log calldata log,
        bytes memory
    ) external view override returns (bool upkeepNeeded, bytes memory performData) {
        address gauge;
        bytes32 eventSignature = log.topics[0];
        if (eventSignature == GAUGE_CREATED_SIGNATURE) {
            gauge = _extractGaugeFromCreatedLog(log);
            if (gaugeUpkeepIds[gauge] == 0) {
                return (true, abi.encode(PerformAction.REGISTER_UPKEEP, gauge));
            }
        } else if (eventSignature == GAUGE_KILLED_SIGNATURE) {
            gauge = _bytes32ToAddress(log.topics[1]);
            if (gaugeUpkeepIds[gauge] != 0) {
                return (true, abi.encode(PerformAction.CANCEL_UPKEEP, gauge));
            }
        } else if (eventSignature == GAUGE_REVIVED_SIGNATURE) {
            gauge = _bytes32ToAddress(log.topics[1]);
            if (gaugeUpkeepIds[gauge] == 0) {
                return (true, abi.encode(PerformAction.REGISTER_UPKEEP, gauge));
            }
        }
    }

    function checkUpkeep(bytes calldata) external view override returns (bool upkeepNeeded, bytes memory performData) {
        for (uint256 i = 0; i < cancelledGaugeUpkeeps.length; i++) {
            address gauge = cancelledGaugeUpkeeps[i];
            if (block.number - cancelledUpkeepBlockNumbers[gauge] >= CANCELLATION_DELAY_BLOCKS) {
                return (true, abi.encode(PerformAction.WITHDRAW_UPKEEP_BALANCE, gauge));
            }
        }
    }

    function performUpkeep(bytes calldata performData) external override(ILogAutomation, AutomationCompatibleInterface) {
        // todo: check if the sender is trusted forwarder
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

    // UPKEEP MANAGEMENT

    function _registerGaugeUpkeep(address gauge) internal returns (uint256 upkeepId) {
        bytes memory job = _encodeCronJob(
            veloVoter,
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
            gasLimit: upkeepGasLimit,
            adminAddress: address(this),
            triggerType: CONDITIONAL_TRIGGER_TYPE,
            checkData: "",
            triggerConfig: "",
            offchainConfig: "",
            amount: upkeepFundAmount
        });
        upkeepId = _registerUpkeep(params);
        gaugeUpkeepIds[gauge] = upkeepId;
        emit GaugeUpkeepRegistered(gauge, upkeepId);
    }

    function _registerUpkeep(RegistrationParams memory params) internal returns (uint256) {
        LinkTokenInterface(linkToken).approve(automationRegistrar, params.amount);
        uint256 upkeepID = AutomationRegistrarInterface(automationRegistrar).registerUpkeep(params);
        if (upkeepID != 0) {
            return upkeepID;
        } else {
            revert AutoApproveDisabled();
        }
    }

    function _cancelGaugeUpkeep(address gauge) internal {
        uint256 upkeepId = gaugeUpkeepIds[gauge];
        KeeperRegistryInterface(keeperRegistry).cancelUpkeep(upkeepId);
        cancelledGaugeUpkeeps.push(gauge);
        cancelledUpkeepBlockNumbers[gauge] = block.number;
        emit GaugeUpkeepCancelled(gauge, upkeepId);
    }

    function _withdrawGaugeUpkeep(address gauge) internal {
        uint256 upkeepId = gaugeUpkeepIds[gauge];
        KeeperRegistryInterface(keeperRegistry).withdrawFunds(upkeepId, address(this));
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
        delete cancelledUpkeepBlockNumbers[gauge];
        delete gaugeUpkeepIds[gauge];
    }

    // UTILS

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

    // todo: withdraw link function
    // todo: transfer upkeep function
    // todo: set gas limit function
    // todo: set fund amount function
}
