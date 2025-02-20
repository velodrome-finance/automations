// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {ILogAutomation, Log} from "@chainlink/contracts/src/v0.8/automation/interfaces/ILogAutomation.sol";
import {IKeeperRegistryMaster} from "@chainlink/contracts/src/v0.8/automation/interfaces/v2_1/IKeeperRegistryMaster.sol";
import {IVoter} from "../vendor/velodrome-contracts/contracts/interfaces/IVoter.sol";
import {IPool} from "../vendor/velodrome-contracts/contracts/interfaces/IPool.sol";
import {IFactoryRegistry} from "../vendor/velodrome-contracts/contracts/interfaces/factories/IFactoryRegistry.sol";
import {IAutomationRegistrar} from "./interfaces/IAutomationRegistrar.sol";
import {IGaugeUpkeepManager} from "./interfaces/IGaugeUpkeepManager.sol";
import {IUpkeepBalanceMonitor} from "./interfaces/IUpkeepBalanceMonitor.sol";
import {GaugeUpkeep} from "./GaugeUpkeep.sol";

contract GaugeUpkeepManager is IGaugeUpkeepManager, ILogAutomation, Ownable {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @inheritdoc IGaugeUpkeepManager
    address public immutable override linkToken;
    /// @inheritdoc IGaugeUpkeepManager
    address public immutable override keeperRegistry;
    /// @inheritdoc IGaugeUpkeepManager
    address public immutable override automationRegistrar;
    /// @inheritdoc IGaugeUpkeepManager
    address public immutable override voter;
    /// @inheritdoc IGaugeUpkeepManager
    address public immutable override factoryRegistry;
    /// @inheritdoc IGaugeUpkeepManager
    address public override upkeepBalanceMonitor;

    /// @inheritdoc IGaugeUpkeepManager
    uint96 public override newUpkeepFundAmount;
    /// @inheritdoc IGaugeUpkeepManager
    uint32 public override newUpkeepGasLimit;
    /// @inheritdoc IGaugeUpkeepManager
    mapping(address => bool) public override trustedForwarder;
    /// @inheritdoc IGaugeUpkeepManager
    mapping(address => bool) public override crosschainGaugeFactory;

    /// @inheritdoc IGaugeUpkeepManager
    uint256[] public override upkeepIds;

    EnumerableSet.AddressSet private _gaugeList;

    uint32 private constant GAUGES_PER_UPKEEP = 100;
    uint32 private constant UPKEEP_CANCEL_BUFFER = 20;
    uint8 private constant CONDITIONAL_TRIGGER_TYPE = 0;
    string private constant UPKEEP_NAME = "Gauge upkeep";

    bytes32 private constant GAUGE_CREATED_SIGNATURE =
        0xef9f7d1ffff3b249c6b9bf2528499e935f7d96bb6d6ec4e7da504d1d3c6279e1;
    bytes32 private constant GAUGE_KILLED_SIGNATURE =
        0x04a5d3f5d80d22d9345acc80618f4a4e7e663cf9e1aed23b57d975acec002ba7;
    bytes32 private constant GAUGE_REVIVED_SIGNATURE =
        0xed18e9faa3dccfd8aa45f69c4de40546b2ca9cccc4538a2323531656516db1aa;

    constructor(
        address _linkToken,
        address _keeperRegistry,
        address _automationRegistrar,
        address _upkeepBalanceMonitor,
        address _voter,
        uint96 _newUpkeepFundAmount,
        uint32 _newUpkeepGasLimit,
        address[] memory _crosschainGaugeFactories
    ) {
        linkToken = _linkToken;
        keeperRegistry = _keeperRegistry;
        automationRegistrar = _automationRegistrar;
        upkeepBalanceMonitor = _upkeepBalanceMonitor;
        voter = _voter;
        newUpkeepFundAmount = _newUpkeepFundAmount;
        newUpkeepGasLimit = _newUpkeepGasLimit;

        // Initialize crosschain gauge factories
        for (uint256 i = 0; i < _crosschainGaugeFactories.length; i++) {
            crosschainGaugeFactory[_crosschainGaugeFactories[i]] = true;
        }
        factoryRegistry = IVoter(_voter).factoryRegistry();
    }

    /// @notice Called by the automation DON when a new log is emitted by the target contract
    /// @param _log the raw log data matching the filter that this contract has registered as a trigger
    /// @dev This function is called by the automation DON to check if any action is needed
    /// @return upkeepNeeded True if any action is needed according to the log
    /// @return performData Encoded action and data passed to performUpkeep if upkeepNeeded is true
    function checkLog(
        Log calldata _log,
        bytes memory
    ) external view override returns (bool upkeepNeeded, bytes memory performData) {
        bytes32 eventSignature = _log.topics[0];
        if (eventSignature == GAUGE_CREATED_SIGNATURE) {
            address gaugeFactory = _bytes32ToAddress(_log.topics[3]);
            address gauge = _extractGaugeFromCreatedLog(_log);
            if (!_gaugeList.contains(gauge) && !_isCrosschainGaugeFactory(gaugeFactory)) {
                return (true, abi.encode(PerformAction.REGISTER_GAUGE, gauge));
            }
        } else if (eventSignature == GAUGE_KILLED_SIGNATURE) {
            address gauge = _bytes32ToAddress(_log.topics[1]);
            if (_gaugeList.contains(gauge)) {
                return (true, abi.encode(PerformAction.DEREGISTER_GAUGE, gauge));
            }
        } else if (eventSignature == GAUGE_REVIVED_SIGNATURE) {
            address gauge = _bytes32ToAddress(_log.topics[1]);
            address gaugeFactory = _getGaugeFactoryFromGauge(gauge);
            if (!_gaugeList.contains(gauge) && !_isCrosschainGaugeFactory(gaugeFactory)) {
                return (true, abi.encode(PerformAction.REGISTER_GAUGE, gauge));
            }
        }
    }

    /// @notice Perform the upkeep action according to the performData passed from checkUpkeep/checkLog
    /// @param _performData the data which was passed back from the checkData simulation
    /// @dev This function is called by the automation network to perform the upkeep action
    function performUpkeep(bytes calldata _performData) external override {
        if (!trustedForwarder[msg.sender]) {
            revert UnauthorizedSender();
        }
        (PerformAction action, address gauge) = abi.decode(_performData, (PerformAction, address));
        if (action == PerformAction.REGISTER_GAUGE) {
            _registerGauge(gauge);
        } else if (action == PerformAction.DEREGISTER_GAUGE) {
            _deregisterGauge(gauge);
        } else {
            revert InvalidPerformAction();
        }
    }

    function _getNextUpkeepStartIndex(uint256 _upkeepCount) internal pure returns (uint256) {
        return _upkeepCount * GAUGES_PER_UPKEEP;
    }

    /// @dev Assumes that the gauge is not already registered
    function _registerGauge(address _gauge) internal {
        uint256 _gaugeCount = _gaugeList.length();
        _gaugeList.add(_gauge);
        if (_gaugeCount % GAUGES_PER_UPKEEP == 0) {
            _registerGaugeUpkeep();
        }
        emit GaugeRegistered(_gauge);
    }

    /// @dev Assumes that the gauge is already registered
    function _deregisterGauge(address _gauge) internal {
        _gaugeList.remove(_gauge);
        uint256 _gaugeCount = _gaugeList.length();
        uint256 _currentUpkeep = upkeepIds.length - 1;
        uint256 currentUpkeepStartIndex = _getNextUpkeepStartIndex(_currentUpkeep);
        if (_gaugeCount + UPKEEP_CANCEL_BUFFER <= currentUpkeepStartIndex || _gaugeCount == 0) {
            _cancelGaugeUpkeep(upkeepIds[_currentUpkeep]);
        }
        emit GaugeDeregistered(_gauge);
    }

    function _registerGaugeUpkeep() internal {
        uint256 startIndex = _getNextUpkeepStartIndex(upkeepIds.length);
        uint256 endIndex = startIndex + GAUGES_PER_UPKEEP;
        address gaugeUpkeep = address(new GaugeUpkeep(voter, startIndex, endIndex));
        emit GaugeUpkeepCreated(gaugeUpkeep, startIndex, endIndex);
        IAutomationRegistrar.RegistrationParams memory params = IAutomationRegistrar.RegistrationParams({
            name: UPKEEP_NAME,
            encryptedEmail: "",
            upkeepContract: gaugeUpkeep,
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
        IUpkeepBalanceMonitor(upkeepBalanceMonitor).addToWatchList(upkeepId);
        emit GaugeUpkeepRegistered(gaugeUpkeep, upkeepId);
    }

    function _registerUpkeep(IAutomationRegistrar.RegistrationParams memory _params) internal returns (uint256) {
        IERC20(linkToken).approve(automationRegistrar, _params.amount);
        uint256 upkeepID = IAutomationRegistrar(automationRegistrar).registerUpkeep(_params);
        if (upkeepID != 0) {
            return upkeepID;
        } else {
            revert AutoApproveDisabled();
        }
    }

    function _cancelGaugeUpkeep(uint256 _upkeepId) internal {
        upkeepIds.pop();
        IUpkeepBalanceMonitor(upkeepBalanceMonitor).removeFromWatchList(_upkeepId);
        IKeeperRegistryMaster(keeperRegistry).cancelUpkeep(_upkeepId);
        emit GaugeUpkeepCancelled(_upkeepId);
    }

    function _extractGaugeFromCreatedLog(Log memory _log) internal pure returns (address gauge) {
        (, , , gauge, ) = abi.decode(_log.data, (address, address, address, address, address));
    }

    function _bytes32ToAddress(bytes32 _address) internal pure returns (address) {
        return address(uint160(uint256(_address)));
    }

    function _getGaugeFactoryFromGauge(address _gauge) internal view returns (address gaugeFactory) {
        address pool = IVoter(voter).poolForGauge(_gauge);
        address poolFactory = IPool(pool).factory();
        (, gaugeFactory) = IFactoryRegistry(factoryRegistry).factoriesToPoolFactory(poolFactory);
    }

    function _isCrosschainGaugeFactory(address _gaugeFactory) internal view returns (bool) {
        return crosschainGaugeFactory[_gaugeFactory];
    }

    /// @inheritdoc IGaugeUpkeepManager
    function withdrawUpkeep(uint256 _upkeepId) external override onlyOwner {
        IKeeperRegistryMaster(keeperRegistry).withdrawFunds(_upkeepId, address(this));
        emit GaugeUpkeepWithdrawn(_upkeepId);
    }

    /// @inheritdoc IGaugeUpkeepManager
    function withdrawLinkBalance() external override onlyOwner {
        address receiver = owner();
        uint256 balance = IERC20(linkToken).balanceOf(address(this));
        if (balance == 0) {
            revert NoLinkBalance();
        }
        IERC20(linkToken).safeTransfer(receiver, balance);
        emit LinkBalanceWithdrawn(receiver, balance);
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
        if (_trustedForwarder == address(0)) {
            revert AddressZeroNotAllowed();
        }
        trustedForwarder[_trustedForwarder] = _isTrusted;
        emit TrustedForwarderSet(_trustedForwarder, _isTrusted);
    }

    /// @inheritdoc IGaugeUpkeepManager
    function setUpkeepBalanceMonitor(address _upkeepBalanceMonitor) external override onlyOwner {
        if (_upkeepBalanceMonitor == address(0)) {
            revert AddressZeroNotAllowed();
        }
        upkeepBalanceMonitor = _upkeepBalanceMonitor;
        emit UpkeepBalanceMonitorSet(_upkeepBalanceMonitor);
    }

    /// @inheritdoc IGaugeUpkeepManager
    function registerGauges(address[] calldata _gauges) external override onlyOwner {
        address gauge;
        address gaugeFactory;
        uint256 length = _gauges.length;
        for (uint256 i = 0; i < length; i++) {
            gauge = _gauges[i];
            if (_gaugeList.contains(gauge)) {
                revert GaugeUpkeepExists(gauge);
            }
            if (!IVoter(voter).isGauge(gauge)) {
                revert NotGauge(gauge);
            }
            gaugeFactory = _getGaugeFactoryFromGauge(gauge);
            if (_isCrosschainGaugeFactory(gaugeFactory)) {
                revert CrosschainGaugeNotAllowed(gauge);
            }
        }
        for (uint256 i = 0; i < length; i++) {
            _registerGauge(_gauges[i]);
        }
    }

    /// @inheritdoc IGaugeUpkeepManager
    function deregisterGauges(address[] calldata _gauges) external override onlyOwner {
        address gauge;
        uint256 length = _gauges.length;
        for (uint256 i = 0; i < length; i++) {
            gauge = _gauges[i];
            if (!_gaugeList.contains(gauge)) {
                revert GaugeUpkeepNotFound(gauge);
            }
        }
        for (uint256 i = 0; i < length; i++) {
            _deregisterGauge(_gauges[i]);
        }
    }

    /// @inheritdoc IGaugeUpkeepManager
    function gaugeCount() external view override returns (uint256) {
        return _gaugeList.length();
    }

    /// @inheritdoc IGaugeUpkeepManager
    function gaugeList(
        uint256 _startIndex,
        uint256 _endIndex
    ) external view override returns (address[] memory gauges) {
        uint256 length = _gaugeList.length();
        _endIndex = _endIndex > length ? length : _endIndex;
        uint256 size = _endIndex - _startIndex;
        gauges = new address[](size);
        for (uint256 i = 0; i < size; i++) {
            gauges[i] = _gaugeList.at(_startIndex + i);
        }
    }

    function upkeepCount() external view override returns (uint256) {
        return upkeepIds.length;
    }
}
