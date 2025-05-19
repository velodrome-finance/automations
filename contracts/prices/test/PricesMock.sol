// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

contract PricesMock {
    uint256 public timeWindow = 1 hours;

    mapping(address => mapping(uint256 => uint256)) public prices;

    event Price(address indexed token, uint256 price);

    function latest(address _token, uint256 _timestamp, uint256 _timeWindow) external view returns (uint256) {
        return prices[_token][(_timestamp / _timeWindow) * _timeWindow];
    }

    function fetchPrice(address _token) external view returns (uint256) {
        return 1;
    }

    function storePrice(address _token, uint256 _price, uint256 _timestamp) external {
        prices[_token][_timestamp] = _price;
        emit Price(_token, _price);
    }

    function setTimeWindow(uint256 _timeWindow) external {
        timeWindow = _timeWindow;
    }
}
