// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

contract VoterMock {
    address public fakeFactoryRegistry;
    address public fakePool;

    event GaugeCreated(
        address indexed poolFactory,
        address indexed votingRewardsFactory,
        address indexed gaugeFactory,
        address pool,
        address bribeVotingReward,
        address feeVotingReward,
        address gauge,
        address creator
    );
    event GaugeKilled(address indexed gauge);
    event GaugeRevived(address indexed gauge);
    event Distributed(address indexed gauge);

    constructor(address _factoryRegistry, address _pool) {
        fakeFactoryRegistry = _factoryRegistry;
        fakePool = _pool;
    }

    function createGauge(address gauge) external {
        emit GaugeCreated(address(0), address(0), address(0), address(0), address(0), address(0), gauge, address(0));
    }

    function killGauge(address gauge) external {
        emit GaugeKilled(gauge);
    }

    function reviveGauge(address gauge) external {
        emit GaugeRevived(gauge);
    }

    function distribute(address gauge) external {
        emit Distributed(gauge);
    }

    function factoryRegistry() external view returns (address) {
        return fakeFactoryRegistry;
    }

    function poolForGauge(address) external view returns (address) {
        return fakePool;
    }
}
