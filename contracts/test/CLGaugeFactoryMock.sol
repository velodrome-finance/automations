// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

contract CLGaugeFactoryMock {
    address public redistributor;

    constructor(address _redistributor) {
        redistributor = _redistributor;
    }
}
