// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {ILogAutomation, Log} from "@chainlink/contracts/src/v0.8/automation/interfaces/ILogAutomation.sol";
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

contract CronUpkeepManager is ILogAutomation {
    address private immutable linkToken;
    address private immutable automationRegistrar;
    address private immutable automationCronDelegate;
    address private immutable veloVoter;

    mapping(address => uint256) private gaugeUpkeepIds;

    uint96 private upkeepFundAmount;
    uint32 private upkeepGasLimit;

    uint8 private constant CONDITIONAL_TRIGGER_TYPE = 0;
    uint256 private constant CRON_UPKEEP_MAX_JOBS = 1;
    string private constant UPKEEP_NAME = "cron upkeep";
    string private constant CRON_EXPRESSION = "0 0 * * 3";
    string private constant DISTRIBUTE_FUNCTION = "distribute(address)";
    
    bytes32 private constant GAUGE_CREATED_SIGNATURE = 0xef9f7d1ffff3b249c6b9bf2528499e935f7d96bb6d6ec4e7da504d1d3c6279e1;

    error AutoApproveDisabled();

    event GaugeUpkeepRegistered(address gauge, uint256 upkeepId);

    constructor(
        address _linkToken,
        address _automationRegistrar,
        address _automationCronDelegate,
        address _veloVoter,
        uint96 _upkeepFundAmount,
        uint32 _upkeepGasLimit
    ) {
        linkToken = _linkToken;
        automationRegistrar = _automationRegistrar;
        automationCronDelegate = _automationCronDelegate;
        veloVoter = _veloVoter;
        upkeepFundAmount = _upkeepFundAmount;
        upkeepGasLimit = _upkeepGasLimit;
    }

    // LOG AUTOMATION

    function checkLog(
        Log calldata log,
        bytes memory
    ) external view override returns (bool upkeepNeeded, bytes memory performData) {
        if (log.topics[0] == GAUGE_CREATED_SIGNATURE) {
            address gauge = _extractGaugeFromLog(log);
            if (gaugeUpkeepIds[gauge] == 0) {
                return (true, abi.encode(gauge));
            }
        }
        // todo: handle gauge killed event
        // todo: handle gauge revived event
    }

    function performUpkeep(bytes calldata performData) external override {
        // todo: check if the sender is trusted forwarder
        address gauge = abi.decode(performData, (address));
        uint256 upkeepId = _registerCronUpkeep(
            _encodeCronJob(
                veloVoter,
                abi.encodeWithSignature(DISTRIBUTE_FUNCTION, gauge),
                CRON_EXPRESSION
            )
        );
        gaugeUpkeepIds[gauge] = upkeepId;
        emit GaugeUpkeepRegistered(gauge, upkeepId);
    }

    // REGISTER UPKEEP

    function _registerCronUpkeep(bytes memory job) internal returns (uint256) {
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
        return _registerUpkeep(params);
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

    // UTILS

    function _encodeCronJob(
        address target,
        bytes memory handler,
        string memory cronString
    ) internal pure returns (bytes memory) {
        Spec memory spec = Cron.toSpec(cronString);
        return abi.encode(target, handler, spec);
    }

    function _extractGaugeFromLog(Log memory log) internal pure returns (address gauge) {
        (,,,gauge,) = abi.decode(log.data, (address, address, address, address, address));
    }

    // todo: withdraw link function
    // todo: transfer upkeep function
    // todo: set gas limit function
    // todo: set fund amount function
}
