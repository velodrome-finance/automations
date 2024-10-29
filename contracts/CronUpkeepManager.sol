// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

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

contract CronUpkeepManager {
    address private immutable linkToken;
    address private immutable automationRegistrar;
    address private immutable automationCronDelegate;

    uint96 private upkeepFundAmount = 1e18;
    uint32 private upkeepGasLimit = 1_000_000;

    uint8 private constant CUSTOM_LOGIC_TRIGGER_TYPE = 0;
    uint256 private constant CRON_UPKEEP_MAX_JOBS = 1;
    string private constant UPKEEP_NAME = "cron upkeep";

    error AutoApproveDisabled();

    event TestUpkeepRegistered(uint256 upkeepId);

    constructor(
        address _linkToken,
        address _automationRegistrar,
        address _automationCronDelegate
    ) {
        linkToken = _linkToken;
        automationRegistrar = _automationRegistrar;
        automationCronDelegate = _automationCronDelegate;
    }

    function __testRegisterUpkeep() external {
        uint256 upkeepId = _registerCronUpkeep(
            _encodeCronJob(
                0x74A4A85C611679B73F402B36c0F84A7D2CcdFDa3, // weth
                abi.encodeWithSignature(
                    "approve(address,uint256)",
                    automationRegistrar,
                    100
                ),
                "*/15 * * * *"
            )
        );
        emit TestUpkeepRegistered(upkeepId);
    }

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
            triggerType: CUSTOM_LOGIC_TRIGGER_TYPE,
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

    function _encodeCronJob(
        address target,
        bytes memory handler,
        string memory cronString
    ) internal pure returns (bytes memory) {
        Spec memory spec = Cron.toSpec(cronString);
        return abi.encode(target, handler, spec);
    }

    // todo: withdraw link function
    // todo: transfer upkeep function
    // todo: set gas limit function
    // todo: set fund amount function
}
