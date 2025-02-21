// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

contract GaugeUpkeepManagerMock {
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet private _gaugeList;

    function setGaugeList(address[] calldata gauges) external {
        for (uint256 i = 0; i < gauges.length; i++) {
            _gaugeList.add(gauges[i]);
        }
    }

    function removeGaugeList() external {
        while (_gaugeList.length() > 0) {
            _gaugeList.remove(_gaugeList.at(_gaugeList.length() - 1));
        }
    }

    function gaugeCount() external view returns (uint256) {
        return _gaugeList.length();
    }

    function gaugeList(uint256 _startIndex, uint256 _endIndex) external view returns (address[] memory gauges) {
        uint256 length = _gaugeList.length();
        _endIndex = _endIndex > length ? length : _endIndex;
        uint256 size = _endIndex - _startIndex;
        gauges = new address[](size);
        for (uint256 i = 0; i < size; i++) {
            gauges[i] = _gaugeList.at(_startIndex + i);
        }
    }
}
