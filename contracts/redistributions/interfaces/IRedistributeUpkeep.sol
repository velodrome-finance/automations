// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

interface IRedistributeUpkeep {
    event RedistributeUpkeepPerformed(uint256 indexed currentIndex, uint256 indexed endIndex);
    event RedistributeFailed(address indexed gauge, uint256 indexed index);

    error UpkeepNotNeeded();

    /// @notice Voter address
    function voter() external view returns (address);

    /// @notice RedistributeUpkeepManager address
    function redistributeUpkeepManager() external view returns (address);

    /// @notice Start index (inclusive) to iterate over the list of gauges
    function startIndex() external view returns (uint256);

    /// @notice End index (exclusive) to iterate over the list of gauges
    function endIndex() external view returns (uint256);

    /// @notice Index of the current epoch iteration
    function currentIndex() external view returns (uint256);

    /// @notice Timestamp of the last epoch flip gauges were distributed
    function lastEpochFlip() external view returns (uint256);

    /// @notice Executes redistributes for a batch of gauges
    function performUpkeep(bytes calldata) external;

    /// @notice Checks if epoch flip has occurred and if there are more gauges to redistribute to
    /// @return _upkeepNeeded signals if upkeep is needed
    function checkUpkeep(bytes calldata) external view returns (bool _upkeepNeeded, bytes memory);
}
