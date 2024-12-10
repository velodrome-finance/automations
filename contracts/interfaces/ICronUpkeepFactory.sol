// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

interface ICronUpkeepFactory {
    event NewCronUpkeepCreated(address upkeep, address owner);

    /// @notice Cron delegate address
    function cronDelegate() external view returns (address);

    /// @notice Creates a new CronUpkeep contract, with msg.sender as the owner, and registers a cron job
    function newCronUpkeepWithJob(bytes memory encodedJob) external returns (address);

    /// @notice Converts, validates, and encodes a full cron spec. This payload is then passed to newCronUpkeepWithJob.
    /// @param target the destination contract of a cron job
    /// @param handler the function signature on the target contract to call
    /// @param cronString the cron string to convert and encode
    /// @return the abi encoding of the entire cron job
    function encodeCronJob(
        address target,
        bytes memory handler,
        string memory cronString
    ) external pure returns (bytes memory);
}
