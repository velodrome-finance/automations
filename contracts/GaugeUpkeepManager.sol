// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ILogAutomation, Log} from "@chainlink/contracts/src/v0.8/automation/interfaces/ILogAutomation.sol";
import {IKeeperRegistryMaster} from "@chainlink/contracts/src/v0.8/automation/interfaces/v2_1/IKeeperRegistryMaster.sol";
import {IAutomationRegistrar} from "./interfaces/IAutomationRegistrar.sol";
import {IGaugeUpkeepManager} from "./interfaces/IGaugeUpkeepManager.sol";
import {ICronUpkeepFactory} from "./interfaces/ICronUpkeepFactory.sol";

contract GaugeUpkeepManager is IGaugeUpkeepManager, ILogAutomation, Ownable {
    using SafeERC20 for IERC20;

    /// @inheritdoc IGaugeUpkeepManager
    address public immutable override linkToken;
    /// @inheritdoc IGaugeUpkeepManager
    address public immutable override keeperRegistry;
    /// @inheritdoc IGaugeUpkeepManager
    address public immutable override automationRegistrar;
    /// @inheritdoc IGaugeUpkeepManager
    address public immutable override cronUpkeepFactory;
    /// @inheritdoc IGaugeUpkeepManager
    address public immutable override voter;

    /// @inheritdoc IGaugeUpkeepManager
    uint96 public override newUpkeepFundAmount;
    /// @inheritdoc IGaugeUpkeepManager
    uint32 public override newUpkeepGasLimit;
    /// @inheritdoc IGaugeUpkeepManager
    mapping(address => bool) public override trustedForwarder;

    /// @inheritdoc IGaugeUpkeepManager
    mapping(address => uint256) public override gaugeUpkeepId;

    uint8 private constant CONDITIONAL_TRIGGER_TYPE = 0;
    string private constant UPKEEP_NAME = "cron upkeep";
    string private constant CRON_EXPRESSION = "0 0 * * 4";
    string private constant DISTRIBUTE_FUNCTION = "distribute(address[])";

    bytes32 private constant GAUGE_CREATED_SIGNATURE =
        0xef9f7d1ffff3b249c6b9bf2528499e935f7d96bb6d6ec4e7da504d1d3c6279e1;
    bytes32 private constant GAUGE_KILLED_SIGNATURE =
        0x04a5d3f5d80d22d9345acc80618f4a4e7e663cf9e1aed23b57d975acec002ba7;
    bytes32 private constant GAUGE_REVIVED_SIGNATURE =
        0xed18e9faa3dccfd8aa45f69c4de40546b2ca9cccc4538a2323531656516db1aa;

    enum PerformAction {
        REGISTER_UPKEEP,
        CANCEL_UPKEEP
    }

    error InvalidPerformAction();
    error AutoApproveDisabled();
    error UnauthorizedSender();

    constructor(
        address _linkToken,
        address _keeperRegistry,
        address _automationRegistrar,
        address _cronUpkeepFactory,
        address _voter,
        uint96 _newUpkeepFundAmount,
        uint32 _newUpkeepGasLimit
    ) {
        linkToken = _linkToken;
        keeperRegistry = _keeperRegistry;
        automationRegistrar = _automationRegistrar;
        cronUpkeepFactory = _cronUpkeepFactory;
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

    /// @inheritdoc ILogAutomation
    /// @notice Perform the upkeep action according to the performData passed from checkUpkeep/checkLog
    /// @dev This function is called by the automation network to perform the upkeep action
    function performUpkeep(bytes calldata performData) external override(ILogAutomation) {
        if (!trustedForwarder[msg.sender]) {
            revert UnauthorizedSender();
        }
        (PerformAction action, address gauge) = abi.decode(performData, (PerformAction, address));
        if (action == PerformAction.REGISTER_UPKEEP) {
            _registerGaugeUpkeep(gauge);
        } else if (action == PerformAction.CANCEL_UPKEEP) {
            _cancelGaugeUpkeep(gauge);
        } else {
            revert InvalidPerformAction();
        }
    }

    function _registerGaugeUpkeep(address gauge) internal returns (uint256 upkeepId) {
        address[] memory gauges = new address[](1);
        gauges[0] = gauge;
        bytes memory job = ICronUpkeepFactory(cronUpkeepFactory).encodeCronJob(
            voter,
            abi.encodeWithSignature(DISTRIBUTE_FUNCTION, gauges),
            CRON_EXPRESSION
        );
        address cronUpkeep = ICronUpkeepFactory(cronUpkeepFactory).newCronUpkeepWithJob(job);
        IAutomationRegistrar.RegistrationParams memory params = IAutomationRegistrar.RegistrationParams({
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

    function _registerUpkeep(IAutomationRegistrar.RegistrationParams memory params) internal returns (uint256) {
        IERC20(linkToken).approve(automationRegistrar, params.amount);
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
        delete gaugeUpkeepId[gauge];
        emit GaugeUpkeepCancelled(gauge, upkeepId);
    }

    function _extractGaugeFromCreatedLog(Log memory log) internal pure returns (address gauge) {
        (, , , gauge, ) = abi.decode(log.data, (address, address, address, address, address));
    }

    function _bytes32ToAddress(bytes32 _address) internal pure returns (address) {
        return address(uint160(uint256(_address)));
    }

    /// @inheritdoc IGaugeUpkeepManager
    function withdrawUpkeep(uint256 upkeepId) external override onlyOwner {
        IKeeperRegistryMaster(keeperRegistry).withdrawFunds(upkeepId, address(this));
        emit GaugeUpkeepWithdrawn(upkeepId);
    }

    /// @inheritdoc IGaugeUpkeepManager
    function withdrawLinkBalance() external override onlyOwner {
        address receiver = owner();
        uint256 balance = IERC20(linkToken).balanceOf(address(this));
        IERC20(linkToken).safeTransfer(receiver, balance);
        emit LinkBalanceWithdrawn(receiver, balance);
    }

    /// @inheritdoc IGaugeUpkeepManager
    function transferUpkeepAdmin(uint256 upkeepId, address newAdmin) external override onlyOwner {
        IKeeperRegistryMaster(keeperRegistry).transferUpkeepAdmin(upkeepId, newAdmin);
        emit GaugeUpkeepAdminTransferred(upkeepId, newAdmin);
    }

    /// @inheritdoc IGaugeUpkeepManager
    function setNewUpkeepGasLimit(uint32 _newUpkeepGasLimit) external override onlyOwner {
        newUpkeepGasLimit = _newUpkeepGasLimit;
        emit NewUpkeepGasLimitSet(_newUpkeepGasLimit);
    }

    /// @inheritdoc IGaugeUpkeepManager
    function setNewUpkeepFundAmount(uint96 _newUpkeepFundAmount) external override onlyOwner {
        newUpkeepFundAmount = _newUpkeepFundAmount;
        emit NewUpkeepFundAmountSet(_newUpkeepFundAmount);
    }

    /// @inheritdoc IGaugeUpkeepManager
    function setTrustedForwarder(address _trustedForwarder, bool _isTrusted) external override onlyOwner {
        trustedForwarder[_trustedForwarder] = _isTrusted;
        emit TrustedForwarderSet(_trustedForwarder, _isTrusted);
    }
}
