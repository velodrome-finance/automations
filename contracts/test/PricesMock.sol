// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PricesMock {
    event Price(address indexed token, uint256 price);

    function fetchPrices(IERC20[] calldata tokens) external {
        for (uint256 i = 0; i < tokens.length; i++) {
            emit Price(address(tokens[i]), 1000);
        }
    }
}
