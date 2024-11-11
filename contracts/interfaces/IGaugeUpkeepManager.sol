// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

interface IGaugeUpkeepManager {
    event GaugeUpkeepRegistered(address gauge, uint256 upkeepId);
    event GaugeUpkeepCancelled(address gauge, uint256 upkeepId);
    event GaugeUpkeepWithdrawn(address gauge, uint256 upkeepId);

    // @notice LINK token address
    function linkToken() external view returns (address);

    // @notice Keeper registry address
    function keeperRegistry() external view returns (address);

    // @notice Automation registrar address
    function automationRegistrar() external view returns (address);

    // @notice Automation cron delegate address
    function automationCronDelegate() external view returns (address);

    // @notice Voter address
    function voter() external view returns (address);

    // @notice Amount of LINK to transfer to upkeep on registration
    function upkeepFundAmount() external view returns (uint96);

    // @notice Gas limit for new upkeeps
    function upkeepGasLimit() external view returns (uint32);

    // @notice Upkeep ID for a gauge
    function gaugeUpkeepId(address gauge) external view returns (uint256);

    // @notice Gauge addresses of cancelled upkeeps
    function cancelledGaugeUpkeeps(uint256 index) external view returns (address);

    // @notice Block number when the upkeep was cancelled
    function cancelledUpkeepBlockNumber(address gauge) external view returns (uint256);
}
