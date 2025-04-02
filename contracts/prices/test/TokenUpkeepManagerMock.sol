// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {PricesMock} from "./PricesMock.sol";

contract TokenUpkeepManagerMock {
    using EnumerableSet for EnumerableSet.AddressSet;

    address public pricesOracle;

    EnumerableSet.AddressSet internal _tokenList;

    event FetchedTokenPrice(address indexed token, uint256 price);

    constructor(address _pricesOracle) {
        pricesOracle = _pricesOracle;
    }

    function setTokenList(address[] calldata _tokens) external {
        for (uint256 i = 0; i < _tokens.length; i++) {
            _tokenList.add(_tokens[i]);
        }
    }

    function removeTokenList() external {
        while (_tokenList.length() > 0) {
            _tokenList.remove(_tokenList.at(_tokenList.length() - 1));
        }
    }

    function fetchPriceByIndex(uint256 _tokenIndex) external view returns (address token, uint256 price) {
        token = _tokenList.at(_tokenIndex);
        address[] memory tokens = new address[](1);
        tokens[0] = token;
        price = PricesMock(pricesOracle).fetchPrices(tokens)[0];
    }

    function storePrice(address _token, uint256 _price) external {
        emit FetchedTokenPrice(_token, _price);
    }

    function tokenAt(uint256 index) external view returns (address) {
        return _tokenList.at(index);
    }

    function tokenCount() external view returns (uint256) {
        return _tokenList.length();
    }
}
