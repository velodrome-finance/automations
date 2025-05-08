// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

contract PricesMock {
    mapping(address => mapping(uint256 => uint256)) public prices;

    event Price(address indexed token, uint256 price);

    function latest(address _token, uint256 _timestamp) external view returns (uint256) {
        return prices[_token][(_timestamp / 1 hours) * 1 hours];
    }

    function fetchPrice(address tokens) external view returns (uint256 price) {
        return 1;
    }

    function storePrice(address _token, uint256 _price) external {
        prices[_token][(block.timestamp / 1 hours) * 1 hours] = _price;
        emit Price(_token, _price);
    }
}
