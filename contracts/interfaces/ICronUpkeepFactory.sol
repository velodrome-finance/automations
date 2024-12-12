// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

interface ICronUpkeepFactory {
    event NewCronUpkeepCreated(address upkeep, address owner);

    /// @notice Cron delegate address
    function cronDelegate() external view returns (address);

    /// @notice Creates a new CronUpkeep contract, with msg.sender as the owner, and registers a cron job
    /// @param _target The destination contract of a cron job
    /// @param _handler The function signature on the target contract to call
    /// @param _cronString The cron string to convert and encode
    /// @return The address of the newly created CronUpkeep contract
    function newCronUpkeep(
        address _target,
        bytes memory _handler,
        string memory _cronString
    ) external returns (address);
}
