// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {StableEnumerableSet} from "../libraries/StableEnumerableSet.sol";
import {PricesMock} from "./PricesMock.sol";

contract TokenUpkeepManagerMock {
    using StableEnumerableSet for StableEnumerableSet.AddressSet;

    address public pricesOracle;

    StableEnumerableSet.AddressSet internal _tokenList;

    event FetchedTokenPrice(address indexed token, uint256 price);
    event LastIndexReached();

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

    function removeFromTokenList(address _token) external {
        _tokenList.remove(_token);
    }

    function fetchFirstNonZeroToken(
        uint256 _startIndex,
        uint256 _endIndex
    ) external view returns (address token, uint256 index, uint256 price) {
        for (uint256 i = _startIndex; i < _endIndex; i++) {
            token = _tokenList.at(i);
            if (token != address(0)) {
                index = i;
                // Fetch price from the oracle
                address[] memory tokens = new address[](1);
                tokens[0] = token;
                price = PricesMock(pricesOracle).fetchPrices(tokens)[0];
                return (token, i, price);
            }
        }
    }

    function storePriceAndCleanup(address _token, uint256 _price, bool _isLastIndex) external returns (bool success) {
        if (PricesMock(pricesOracle).latest(_token, block.timestamp) == 0) {
            success = true;
            emit FetchedTokenPrice(_token, _price);
        }
        if (_isLastIndex) {
            emit LastIndexReached();
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
