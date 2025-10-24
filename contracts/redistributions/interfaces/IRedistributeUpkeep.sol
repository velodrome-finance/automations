// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

interface IGaugeUpkeep {
    event GaugeUpkeepPerformed(uint256 indexed currentIndex, uint256 indexed endIndex);
    event DistributeFailed(address indexed gauge, uint256 indexed index);

    error UpkeepNotNeeded();

    /// @notice Voter address
    function voter() external view returns (address);

    /// @notice GaugeUpkeepManager address
    function gaugeUpkeepManager() external view returns (address);

    /// @notice Start index (inclusive) to iterate over the list of gauges
    function startIndex() external view returns (uint256);

    /// @notice End index (exclusive) to iterate over the list of gauges
    function endIndex() external view returns (uint256);

    /// @notice Index of the current epoch iteration
    function currentIndex() external view returns (uint256);

    /// @notice Timestamp of the last epoch flip gauges were distributed
    function lastEpochFlip() external view returns (uint256);

    /// @notice Executes distributes for a batch of gauges
    function performUpkeep(bytes calldata) external;

    /// @notice Checks if epoch flip has occurred and if there are more gauges to distribute to
    /// @return _upkeepNeeded signals if upkeep is needed
    function checkUpkeep(bytes calldata) external view returns (bool _upkeepNeeded, bytes memory);
}
