// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

contract FactoryRegistryMock {
    address gaugeFactory;

    function factoriesToPoolFactory(address) external view returns (address, address) {
        return (address(0), gaugeFactory);
    }

    function setGaugeFactory(address _gaugeFactory) external {
        gaugeFactory = _gaugeFactory;
    }
}
