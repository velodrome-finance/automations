// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {StableEnumerableSet} from "../libraries/StableEnumerableSet.sol";
import {PricesMock} from "./PricesMock.sol";

contract TokenUpkeepManagerMock {
    using StableEnumerableSet for StableEnumerableSet.AddressSet;

    address public pricesOracle;

    StableEnumerableSet.AddressSet internal _tokenList;

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
        address[] memory current = _tokenList.values();
        for (uint256 i = 0; i < current.length; i++) {
            _tokenList.remove(current[i]);
        }
    }

    function fetchPriceByIndex(uint256 _tokenIndex) external view returns (address token, uint256 price) {
        token = _tokenList.at(_tokenIndex);
        address[] memory tokens = new address[](1);
        tokens[0] = token;
        price = PricesMock(pricesOracle).fetchPrices(tokens)[0];
    }

    function storePrice(address _token, uint256 _price) external returns (bool success) {
        if (PricesMock(pricesOracle).latest(_token, block.timestamp) == 0) {
            success = true;
            emit FetchedTokenPrice(_token, _price);
        }
    }

    function tokenAt(uint256 index) external view returns (address) {
        return _tokenList.at(index);
    }

    function tokenCount() external view returns (uint256) {
        return _tokenList.lengthWithoutZeroes();
    }

    function tokenListLength() external view returns (uint256) {
        return _tokenList.length();
    }
}
