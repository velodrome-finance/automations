// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

contract VoterMock {
    address public pool;
    address public gaugeFactory;
    address public factoryRegistry;

    mapping(address => bool) public failingGauges;
    mapping(address => bool) public _isWhitelistedToken;

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
    event WhitelistToken(address indexed whitelister, address indexed token, bool indexed _bool);

    constructor(address _pool, address _factoryRegistry, address _gaugeFactory) {
        pool = _pool;
        factoryRegistry = _factoryRegistry;
        gaugeFactory = _gaugeFactory;
    }

    function createGauge(address _gauge) external {
        emit GaugeCreated(address(0), address(0), gaugeFactory, address(0), address(0), address(0), _gauge, address(0));
    }

    function killGauge(address _gauge) external {
        emit GaugeKilled(_gauge);
    }

    function reviveGauge(address _gauge) external {
        emit GaugeRevived(_gauge);
    }

    function distribute(address[] calldata _gauges) external {
        for (uint256 i = 0; i < _gauges.length; i++) {
            if (failingGauges[_gauges[i]]) {
                revert("Failing distribution");
            } else {
                emit Distributed(_gauges[i]);
            }
        }
    }

    function whitelistToken(address _token, bool _bool) external {
        _isWhitelistedToken[_token] = _bool;
        emit WhitelistToken(msg.sender, _token, _bool);
    }

    function isWhitelistedToken(address _token) external view returns (bool) {
        return _isWhitelistedToken[_token];
    }

    function isGauge(address) external view returns (bool) {
        return true;
    }

    function isAlive(address) external view returns (bool) {
        return true;
    }

    function poolForGauge(address) external view returns (address) {
        return pool;
    }

    function setGaugeFactory(address _gaugeFactory) external {
        gaugeFactory = _gaugeFactory;
    }

    function setFailingGauge(address _gauge, bool _failing) external {
        failingGauges[_gauge] = _failing;
    }
}
