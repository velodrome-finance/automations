// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Log} from "@chainlink/contracts/src/v0.8/automation/interfaces/ILogAutomation.sol";
import {IVoter} from "../../../vendor/velodrome-contracts/contracts/interfaces/IVoter.sol";
import {IPool} from "../../../vendor/velodrome-contracts/contracts/interfaces/IPool.sol";
import {IFactoryRegistry} from "../../../vendor/velodrome-contracts/contracts/interfaces/factories/IFactoryRegistry.sol";
import {IRedistributeUpkeepManager} from "../interfaces/common/IRedistributeUpkeepManager.sol";

abstract contract RedistributeUpkeepManager is IRedistributeUpkeepManager, Ownable {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.UintSet;

    /// @inheritdoc IRedistributeUpkeepManager
    address public immutable override linkToken;
    /// @inheritdoc IRedistributeUpkeepManager
    address public immutable override automationRegistrar;
    /// @inheritdoc IRedistributeUpkeepManager
    address public immutable override voter;
    /// @inheritdoc IRedistributeUpkeepManager
    address public immutable override factoryRegistry;
    /// @inheritdoc IRedistributeUpkeepManager
    address public override upkeepBalanceMonitor;

    /// @inheritdoc IRedistributeUpkeepManager
    uint96 public override newUpkeepFundAmount;
    /// @inheritdoc IRedistributeUpkeepManager
    uint32 public override newUpkeepGasLimit;
    /// @inheritdoc IRedistributeUpkeepManager
    uint8 public override batchSize;
    /// @inheritdoc IRedistributeUpkeepManager
    mapping(address => bool) public override trustedForwarder;
    /// @inheritdoc IRedistributeUpkeepManager
    mapping(address => bool) public override excludedGaugeFactory;

    /// @inheritdoc IRedistributeUpkeepManager
    uint256[] public override upkeepIds;

    EnumerableSet.AddressSet private _gaugeList;
    EnumerableSet.UintSet internal _cancelledUpkeepIds;

    uint256 internal constant GAUGES_PER_UPKEEP = 100;
    uint256 internal constant UPKEEP_CANCEL_BUFFER = 20;
    uint8 internal constant CONDITIONAL_TRIGGER_TYPE = 0;
    string internal constant UPKEEP_NAME = "Redistribute upkeep";

    bytes32 private constant GAUGE_CREATED_SIGNATURE =
        0xef9f7d1ffff3b249c6b9bf2528499e935f7d96bb6d6ec4e7da504d1d3c6279e1;
    bytes32 private constant GAUGE_KILLED_SIGNATURE =
        0x04a5d3f5d80d22d9345acc80618f4a4e7e663cf9e1aed23b57d975acec002ba7;
    bytes32 private constant GAUGE_REVIVED_SIGNATURE =
        0xed18e9faa3dccfd8aa45f69c4de40546b2ca9cccc4538a2323531656516db1aa;

    constructor(
        address _linkToken,
        address _automationRegistrar,
        address _upkeepBalanceMonitor,
        address _voter,
        uint96 _newUpkeepFundAmount,
        uint32 _newUpkeepGasLimit,
        uint8 _batchSize,
        address[] memory _excludedGaugeFactories
    ) {
        linkToken = _linkToken;
        automationRegistrar = _automationRegistrar;
        upkeepBalanceMonitor = _upkeepBalanceMonitor;
        voter = _voter;
        newUpkeepFundAmount = _newUpkeepFundAmount;
        newUpkeepGasLimit = _newUpkeepGasLimit;
        batchSize = _batchSize;

        // Initialize excluded gauge factories
        for (uint256 i = 0; i < _excludedGaugeFactories.length; i++) {
            excludedGaugeFactory[_excludedGaugeFactories[i]] = true;
        }
        factoryRegistry = IVoter(_voter).factoryRegistry();
    }

    /// @inheritdoc IRedistributeUpkeepManager
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

    /// @inheritdoc IRedistributeUpkeepManager
    function registerGauges(address[] calldata _gauges) external override onlyOwner {
        address gauge;
        address gaugeFactory;
        uint256 length = _gauges.length;
        for (uint256 i = 0; i < length; i++) {
            gauge = _gauges[i];
            if (_gaugeList.contains(gauge)) {
                revert RedistributeUpkeepExists(gauge);
            }
            if (!IVoter(voter).isGauge(gauge)) {
                revert NotGauge(gauge);
            }
            gaugeFactory = _getGaugeFactoryFromGauge(gauge);
            if (_isExcludedGaugeFactory(gaugeFactory)) {
                revert GaugeNotAllowed(gauge);
            }
        }
        for (uint256 i = 0; i < length; i++) {
            _registerGauge(_gauges[i]);
        }
    }

    /// @inheritdoc IRedistributeUpkeepManager
    function deregisterGauges(address[] calldata _gauges) external override onlyOwner {
        address gauge;
        uint256 length = _gauges.length;
        for (uint256 i = 0; i < length; i++) {
            gauge = _gauges[i];
            if (!_gaugeList.contains(gauge)) {
                revert RedistributeUpkeepNotFound(gauge);
            }
        }
        for (uint256 i = 0; i < length; i++) {
            _deregisterGauge(_gauges[i]);
        }
    }

    /// @inheritdoc IRedistributeUpkeepManager
    function withdrawCancelledUpkeeps(uint256 _startIndex, uint256 _endIndex) external override onlyOwner {
        uint256 length = _cancelledUpkeepIds.length();
        _endIndex = _endIndex > length ? length : _endIndex;
        if (_startIndex >= _endIndex) {
            revert InvalidIndex();
        }
        for (uint256 i = _endIndex; i > _startIndex; i--) {
            _withdrawUpkeep(_cancelledUpkeepIds.at(i - 1));
        }
    }

    /// @inheritdoc IRedistributeUpkeepManager
    function withdrawLinkBalance() external override onlyOwner {
        uint256 balance = IERC20(linkToken).balanceOf(address(this));
        if (balance == 0) {
            revert NoLinkBalance();
        }
        IERC20(linkToken).safeTransfer(msg.sender, balance);
        emit LinkBalanceWithdrawn(msg.sender, balance);
    }

    /// @inheritdoc IRedistributeUpkeepManager
    function setNewUpkeepGasLimit(uint32 _newUpkeepGasLimit) external override onlyOwner {
        newUpkeepGasLimit = _newUpkeepGasLimit;
        emit NewUpkeepGasLimitSet(_newUpkeepGasLimit);
    }

    /// @inheritdoc IRedistributeUpkeepManager
    function setNewUpkeepFundAmount(uint96 _newUpkeepFundAmount) external override onlyOwner {
        newUpkeepFundAmount = _newUpkeepFundAmount;
        emit NewUpkeepFundAmountSet(_newUpkeepFundAmount);
    }

    /// @inheritdoc IRedistributeUpkeepManager
    function setBatchSize(uint8 _batchSize) external override onlyOwner {
        if (_batchSize == 0 || _batchSize > GAUGES_PER_UPKEEP) revert InvalidBatchSize();
        batchSize = _batchSize;
        emit BatchSizeSet(_batchSize);
    }

    /// @inheritdoc IRedistributeUpkeepManager
    function setTrustedForwarder(address _trustedForwarder, bool _isTrusted) external override onlyOwner {
        if (_trustedForwarder == address(0)) {
            revert AddressZeroNotAllowed();
        }
        trustedForwarder[_trustedForwarder] = _isTrusted;
        emit TrustedForwarderSet(_trustedForwarder, _isTrusted);
    }

    /// @inheritdoc IRedistributeUpkeepManager
    function setUpkeepBalanceMonitor(address _upkeepBalanceMonitor) external override onlyOwner {
        if (_upkeepBalanceMonitor == address(0)) {
            revert AddressZeroNotAllowed();
        }
        upkeepBalanceMonitor = _upkeepBalanceMonitor;
        emit UpkeepBalanceMonitorSet(_upkeepBalanceMonitor);
    }

    /// @inheritdoc IRedistributeUpkeepManager
    function setExcludedGaugeFactory(address _gaugeFactory, bool _isExcluded) external override onlyOwner {
        if (_gaugeFactory == address(0)) {
            revert AddressZeroNotAllowed();
        }
        excludedGaugeFactory[_gaugeFactory] = _isExcluded;
        emit ExcludedGaugeFactorySet(_gaugeFactory, _isExcluded);
    }

    /// @inheritdoc IRedistributeUpkeepManager
    function checkLog(
        Log calldata _log,
        bytes memory
    ) external view override returns (bool upkeepNeeded, bytes memory performData) {
        bytes32 eventSignature = _log.topics[0];
        if (eventSignature == GAUGE_CREATED_SIGNATURE) {
            address gaugeFactory = _bytes32ToAddress(_log.topics[3]);
            address gauge = _extractGaugeFromCreatedLog(_log);
            if (!_gaugeList.contains(gauge) && !_isExcludedGaugeFactory(gaugeFactory)) {
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
            if (!_gaugeList.contains(gauge) && !_isExcludedGaugeFactory(gaugeFactory)) {
                return (true, abi.encode(PerformAction.REGISTER_GAUGE, gauge));
            }
        }
    }

    /// @inheritdoc IRedistributeUpkeepManager
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

    /// @inheritdoc IRedistributeUpkeepManager
    function gaugeCount() external view override returns (uint256) {
        return _gaugeList.length();
    }

    /// @inheritdoc IRedistributeUpkeepManager
    function upkeepCount() external view override returns (uint256) {
        return upkeepIds.length;
    }

    /// @inheritdoc IRedistributeUpkeepManager
    function cancelledUpkeeps(
        uint256 _startIndex,
        uint256 _endIndex
    ) external view override returns (uint256[] memory cancelledUpkeepIds) {
        uint256 length = _cancelledUpkeepIds.length();
        _endIndex = _endIndex > length ? length : _endIndex;
        uint256 size = _endIndex - _startIndex;
        cancelledUpkeepIds = new uint256[](size);
        for (uint256 i = 0; i < size; i++) {
            cancelledUpkeepIds[i] = _cancelledUpkeepIds.at(_startIndex + i);
        }
    }

    /// @inheritdoc IRedistributeUpkeepManager
    function cancelledUpkeepCount() external view override returns (uint256) {
        return _cancelledUpkeepIds.length();
    }

    /// @dev Assumes that the gauge is not already registered
    function _registerGauge(address _gauge) internal {
        if (!IVoter(voter).isAlive(_gauge)) {
            revert GaugeNotAlive(_gauge);
        }
        uint256 _gaugeCount = _gaugeList.length();
        _gaugeList.add(_gauge);
        if (_gaugeCount % GAUGES_PER_UPKEEP == 0) {
            _registerRedistributeUpkeep();
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
            _cancelRedistributeUpkeep(upkeepIds[_currentUpkeep]);
        }
        emit GaugeDeregistered(_gauge);
    }

    function _registerRedistributeUpkeep() internal virtual;

    function _cancelRedistributeUpkeep(uint256 _upkeepId) internal virtual;

    function _withdrawUpkeep(uint256 _upkeepId) internal virtual;

    function _getNextUpkeepStartIndex(uint256 _upkeepCount) internal pure returns (uint256) {
        return _upkeepCount * GAUGES_PER_UPKEEP;
    }

    function _getGaugeFactoryFromGauge(address _gauge) internal view returns (address gaugeFactory) {
        address pool = IVoter(voter).poolForGauge(_gauge);
        address poolFactory = IPool(pool).factory();
        (, gaugeFactory) = IFactoryRegistry(factoryRegistry).factoriesToPoolFactory(poolFactory);
    }

    function _extractGaugeFromCreatedLog(Log memory _log) internal pure returns (address gauge) {
        (, , , gauge, ) = abi.decode(_log.data, (address, address, address, address, address));
    }

    function _isExcludedGaugeFactory(address _gaugeFactory) internal view returns (bool) {
        return excludedGaugeFactory[_gaugeFactory];
    }

    function _bytes32ToAddress(bytes32 _address) internal pure returns (address) {
        return address(uint160(uint256(_address)));
    }
}
