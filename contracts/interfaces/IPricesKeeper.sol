// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPricesKeeper {
    event WhitelistedTokenAdded(address token);
    event FetchedPrices(IERC20[] tokens);
    event BatchSizeSet(uint32 batchSize);

    /// @notice Voter contract address
    function voter() external view returns (address);

    /// @notice Prices contract address
    function prices() external view returns (address);

    /// @notice Whitelisted tokens array
    function whitelistedTokens(uint256 index) external view returns (address);

    /// @notice Batch size of tokens to fetch per call
    function batchSize() external view returns (uint32);

    /// @notice Current batch index for a given timestamp
    function batchIndex(uint256 timestamp) external view returns (uint32);

    /// @notice Last fetch timestamp round to the last hour
    function lastFetchTimestamp() external view returns (uint256);

    /// @notice Set the batch size of tokens to fetch per upkeep perform
    function setBatchSize(uint32 _batchSize) external;
}
