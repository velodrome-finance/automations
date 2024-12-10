// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

interface ICronUpkeepFactory {
    event NewCronUpkeepCreated(address upkeep, address owner);

    /// @notice Cron delegate address
    function cronDelegate() external view returns (address);

    /// @notice Creates a new CronUpkeep contract, with msg.sender as the owner, and registers a cron job
    /// @param _encodedJob The encoded cron job to register
    function newCronUpkeepWithJob(bytes memory _encodedJob) external returns (address);

    /// @notice Converts, validates, and encodes a full cron spec. This payload is then passed to newCronUpkeepWithJob.
    /// @param _target The destination contract of a cron job
    /// @param _handler The function signature on the target contract to call
    /// @param _cronString The cron string to convert and encode
    /// @return The abi encoding of the entire cron job
    function encodeCronJob(
        address _target,
        bytes memory _handler,
        string memory _cronString
    ) external pure returns (bytes memory);
}
