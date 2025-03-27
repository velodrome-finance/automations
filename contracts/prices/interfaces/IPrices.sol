// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

interface IPrices {
    function latest(address _token, uint256 _timestamp) external view returns (uint256);

    function fetchPrices(address[] calldata _tokens) external view returns (uint256[] memory _prices);

    function storePrices(address[] calldata _tokens, uint256[] calldata _prices) external;
}
