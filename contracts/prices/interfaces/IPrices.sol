// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

interface IPrices {
    function latest(address _token, uint256 _timestamp) external view returns (uint256);

    function timeWindow() external view returns (uint256);

    function fetchPrice(address _token) external view returns (uint256 _price);

    function storePrice(address _token, uint256 _price) external;

    function addKeeper(address _keeper) external;

    function setStableToken(address _stableToken) external;

    function setTimeWindow(uint256 _timeWindow) external;
}
