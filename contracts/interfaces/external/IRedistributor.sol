// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IRedistributor {
    /// @notice Redistributes the emissions to the given gauges according to their voting weight
    /// @param _gauges The array of gauge addresses to redistribute emissions to
    /// @dev Only callable by keepers registered in the RedistributeUpkeepManager or the keeper
    function redistribute(address[] memory _gauges) external;

    /// @notice Sets the UpkeepManager contract to manage keepers
    /// @param _upkeepManager The address to be set as UpkeepManager
    /// @dev Only callable by the owner
    function setUpkeepManager(address _upkeepManager) external;
}
