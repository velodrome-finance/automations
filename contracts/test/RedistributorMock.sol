// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

contract RedistributorMock {
    mapping(address => bool) public failingGauges;

    event Redistributed(address indexed gauge);

    function redistribute(address[] calldata _gauges) external {
        for (uint256 i = 0; i < _gauges.length; i++) {
            if (failingGauges[_gauges[i]]) {
                revert("Failing distribution");
            } else {
                emit Redistributed(_gauges[i]);
            }
        }
    }

    function setFailingGauge(address _gauge, bool _failing) external {
        failingGauges[_gauge] = _failing;
    }
}
