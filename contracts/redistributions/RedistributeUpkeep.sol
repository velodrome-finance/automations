// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {IVoter} from "../../vendor/velodrome-contracts/contracts/interfaces/IVoter.sol";
import {IRedistributeUpkeepManager} from "./interfaces/common/IRedistributeUpkeepManager.sol";
import {IRedistributeUpkeep} from "./interfaces/IRedistributeUpkeep.sol";

contract RedistributeUpkeep is IRedistributeUpkeep {
    /// @inheritdoc IRedistributeUpkeep
    address public immutable override voter;
    /// @inheritdoc IRedistributeUpkeep
    address public immutable override clGaugeFactory;
    /// @inheritdoc IRedistributeUpkeep
    address public immutable override redistributeUpkeepManager;
    /// @inheritdoc IRedistributeUpkeep
    uint256 public immutable override startIndex;
    /// @inheritdoc IRedistributeUpkeep
    uint256 public immutable override endIndex;

    /// @inheritdoc IRedistributeUpkeep
    uint256 public override currentIndex;
    /// @inheritdoc IRedistributeUpkeep
    uint256 public override lastEpochFlip;

    uint256 private constant WEEK = 7 days;

    constructor(address _voter, address _clGaugeFactory, uint256 _startIndex, uint256 _endIndex) {
        voter = _voter;
        clGaugeFactory = _clGaugeFactory;
        redistributeUpkeepManager = msg.sender;
        startIndex = _startIndex;
        endIndex = _endIndex;
        currentIndex = _startIndex;
        lastEpochFlip = _lastEpochFlip();
    }

    /// @inheritdoc IRedistributeUpkeep
    function performUpkeep(bytes calldata) external override {
        uint256 _currentIndex = currentIndex;
        uint256 _endIndex = _adjustedEndIndex();

        if (!_checkUpkeep(_currentIndex, _endIndex)) revert UpkeepNotNeeded();

        uint256 nextIndex = _currentIndex + IRedistributeUpkeepManager(redistributeUpkeepManager).batchSize();
        nextIndex = nextIndex > _endIndex ? _endIndex : nextIndex;

        _distributeBatch(_currentIndex, nextIndex);

        if (nextIndex < _endIndex) {
            currentIndex = nextIndex;
        } else {
            currentIndex = startIndex;
            lastEpochFlip = _lastEpochFlip();
        }
        emit RedistributeUpkeepPerformed(_currentIndex, nextIndex);
    }

    /// @inheritdoc IRedistributeUpkeep
    function checkUpkeep(bytes calldata) external view override returns (bool _upkeepNeeded, bytes memory) {
        _upkeepNeeded = _checkUpkeep(currentIndex, _adjustedEndIndex());
    }

    function _distributeBatch(uint256 _startIndex, uint256 _endIndex) internal {
        address[] memory gauges = IRedistributeUpkeepManager(redistributeUpkeepManager).gaugeList(
            _startIndex,
            _endIndex
        );

        uint256 length = gauges.length;
        address[] memory singleGauge = new address[](1);
        for (uint256 i = 0; i < length; i++) {
            singleGauge[0] = gauges[i];

            try IVoter(voter).distribute(singleGauge) {} catch {
                emit RedistributeFailed({gauge: singleGauge[0], index: _startIndex + i});
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
        uint256 gaugeCount = IRedistributeUpkeepManager(redistributeUpkeepManager).gaugeCount();
        return gaugeCount < endIndex ? gaugeCount : endIndex;
    }
}
