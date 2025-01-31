// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {IVoter} from "../vendor/velodrome-contracts/contracts/interfaces/IVoter.sol";
import {IGaugeUpkeepManager} from "./interfaces/IGaugeUpkeepManager.sol";
import {IGaugeUpkeep} from "./interfaces/IGaugeUpkeep.sol";

contract GaugeUpkeep is IGaugeUpkeep {
    /// @inheritdoc IGaugeUpkeep
    address public immutable override voter;
    /// @inheritdoc IGaugeUpkeep
    address public immutable override gaugeUpkeepManager;
    /// @inheritdoc IGaugeUpkeep
    uint256 public immutable override startIndex;
    /// @inheritdoc IGaugeUpkeep
    uint256 public immutable override endIndex;

    /// @inheritdoc IGaugeUpkeep
    uint256 public override currentIndex;
    /// @inheritdoc IGaugeUpkeep
    uint256 public override lastEpochFlip;

    uint32 private constant BATCH_SIZE = 5;
    uint256 private constant EPOCH_LENGTH = 7 days;
    uint256 private constant THURSDAY_INDEX = 0;

    constructor(address _voter, address _gaugeUpkeepManager, uint256 _startIndex, uint256 _endIndex) {
        voter = _voter;
        gaugeUpkeepManager = _gaugeUpkeepManager;
        startIndex = _startIndex;
        endIndex = _endIndex;
        currentIndex = _startIndex;
    }

    /// @inheritdoc IGaugeUpkeep
    function checkUpkeep(bytes calldata) external view override returns (bool _upkeepNeeded, bytes memory) {
        _upkeepNeeded = _shouldPerformUpkeep(block.timestamp, currentIndex, _adjustedEndIndex());
    }

    function _shouldPerformUpkeep(
        uint256 _timestamp,
        uint256 _currentIndex,
        uint256 _endIndex
    ) internal view returns (bool) {
        return _newEpochFlip(_timestamp) && _currentIndex < _endIndex;
    }

    function _adjustedEndIndex() internal view returns (uint256) {
        uint256 gaugeCount = IGaugeUpkeepManager(gaugeUpkeepManager).gaugeCount();
        return gaugeCount < endIndex ? gaugeCount : endIndex;
    }

    /// @dev Epoch flips every Thursday at 00:00 UTC
    function _newEpochFlip(uint256 _timestamp) internal view returns (bool) {
        return (_timestamp / 1 days) % 7 == THURSDAY_INDEX && lastEpochFlip + EPOCH_LENGTH <= _timestamp;
    }

    /// @inheritdoc IGaugeUpkeep
    function performUpkeep(bytes calldata) external override {
        uint256 _currentIndex = currentIndex;
        uint256 _endIndex = _adjustedEndIndex();

        if (!_shouldPerformUpkeep(block.timestamp, _currentIndex, _endIndex)) {
            revert UpkeepNotNeeded();
        }
        uint256 nextIndex = _currentIndex + BATCH_SIZE;
        _distributeBatch(_currentIndex, nextIndex);

        if (nextIndex < _endIndex) {
            currentIndex = nextIndex;
        } else {
            currentIndex = startIndex;
            lastEpochFlip = (block.timestamp / 1 days) * 1 days;
        }
        emit GaugeUpkeepPerformed(_currentIndex, nextIndex);
    }

    function _distributeBatch(uint256 _startIndex, uint256 _endIndex) internal {
        address[] memory gauges = IGaugeUpkeepManager(gaugeUpkeepManager).gaugeList(_startIndex, _endIndex);
        IVoter(voter).distribute(gauges);
    }
}
