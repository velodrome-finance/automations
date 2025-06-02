// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {IVoter} from "../../vendor/velodrome-contracts/contracts/interfaces/IVoter.sol";
import {IGaugeUpkeepManager} from "./interfaces/common/IGaugeUpkeepManager.sol";
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

    uint256 private constant WEEK = 7 days;

    constructor(address _voter, uint256 _startIndex, uint256 _endIndex) {
        voter = _voter;
        gaugeUpkeepManager = msg.sender;
        startIndex = _startIndex;
        endIndex = _endIndex;
        currentIndex = _startIndex;
        lastEpochFlip = _lastEpochFlip();
    }

    /// @inheritdoc IGaugeUpkeep
    function performUpkeep(bytes calldata) external override {
        uint256 _currentIndex = currentIndex;
        uint256 _endIndex = _adjustedEndIndex();

        if (!_checkUpkeep(_currentIndex, _endIndex)) revert UpkeepNotNeeded();

        uint256 nextIndex = _currentIndex + IGaugeUpkeepManager(gaugeUpkeepManager).batchSize();
        nextIndex = nextIndex > _endIndex ? _endIndex : nextIndex;

        _distributeBatch(_currentIndex, nextIndex);

        if (nextIndex < _endIndex) {
            currentIndex = nextIndex;
        } else {
            currentIndex = startIndex;
            lastEpochFlip = _lastEpochFlip();
        }
        emit GaugeUpkeepPerformed(_currentIndex, nextIndex);
    }

    /// @inheritdoc IGaugeUpkeep
    function checkUpkeep(bytes calldata) external view override returns (bool _upkeepNeeded, bytes memory) {
        _upkeepNeeded = _checkUpkeep(currentIndex, _adjustedEndIndex());
    }

    function _distributeBatch(uint256 _startIndex, uint256 _endIndex) internal {
        address[] memory gauges = IGaugeUpkeepManager(gaugeUpkeepManager).gaugeList(_startIndex, _endIndex);
        
        for (uint256 i = 0; i < gauges.length; i++) {
            address[] memory singleGauge = new address[](1);
            singleGauge[0] = gauges[i];

            try IVoter(voter).distribute(singleGauge) {} catch {
                emit BatchDistributeFailed(_startIndex + i, _startIndex + i + 1);
            }
        }
    }

    function _checkUpkeep(uint256 _currentIndex, uint256 _endIndex) internal view returns (bool) {
        return lastEpochFlip + WEEK <= block.timestamp && _currentIndex < _endIndex;
    }

    function _lastEpochFlip() internal view returns (uint256) {
        return (block.timestamp / WEEK) * WEEK;
    }

    function _adjustedEndIndex() internal view returns (uint256) {
        uint256 gaugeCount = IGaugeUpkeepManager(gaugeUpkeepManager).gaugeCount();
        return gaugeCount < endIndex ? gaugeCount : endIndex;
    }
}
