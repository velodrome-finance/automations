// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

contract PricesMock {
    mapping(address => mapping(uint256 => uint256)) public prices;

    event Price(address indexed token, uint256 price);

    function latest(address _token, uint256 _timestamp) external view returns (uint256) {
        return prices[_token][_timestamp];
    }

    function fetchPrices(address[] calldata _tokens) external view returns (uint256[] memory _prices) {
        _prices = new uint256[](_tokens.length);
        for (uint256 i = 0; i < _tokens.length; i++) {
            _prices[i] = 1;
        }
    }

    function storePrices(address[] calldata _tokens, uint256[] calldata _prices) external {
        require(_tokens.length == _prices.length, "PricesMock: invalid input length");
        for (uint256 i = 0; i < _tokens.length; i++) {
            prices[_tokens[i]][(block.timestamp / 1 hours) * 1 hours] = _prices[i];
            emit Price(_tokens[i], _prices[i]);
        }
    }
}
