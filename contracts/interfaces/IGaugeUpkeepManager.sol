// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

interface IGaugeUpkeepManager {
    event GaugeUpkeepRegistered(address gauge, uint256 upkeepId);
    event GaugeUpkeepCancelled(address gauge, uint256 upkeepId);
    event GaugeUpkeepWithdrawn(address gauge, uint256 upkeepId);

    /// @notice LINK token address
    function linkToken() external view returns (address);

    /// @notice Keeper registry address
    function keeperRegistry() external view returns (address);

    /// @notice Automation registrar address
    function automationRegistrar() external view returns (address);

    /// @notice Automation cron delegate address
    function cronUpkeepFactory() external view returns (address);

    /// @notice Voter address
    function voter() external view returns (address);

    /// @notice Automation trusted forwarder address
    function trustedForwarder() external view returns (address);

    /// @notice Amount of LINK to transfer to upkeep on registration
    function newUpkeepFundAmount() external view returns (uint96);

    /// @notice Gas limit for new upkeeps
    function newUpkeepGasLimit() external view returns (uint32);

    /// @notice Upkeep ID for a gauge
    function gaugeUpkeepId(address gauge) external view returns (uint256);

    /// @notice Gauge addresses of cancelled upkeeps
    function cancelledGaugeUpkeeps(uint256 index) external view returns (address);

    /// @notice Block number when the upkeep was cancelled
    function cancelledUpkeepBlockNumber(address gauge) external view returns (uint256);

    /// @notice Transfer contract LINK balance to owner
    function withdrawLinkBalance() external;

    /// @notice Transfer gauge upkeep admin rights to a new address
    /// @param upkeepId Upkeep ID
    /// @param newAdmin New admin address
    function transferUpkeepAdmin(uint256 upkeepId, address newAdmin) external;

    /// @notice Update the gas limit for new gauge upkeeps
    /// @param newUpkeepGasLimit New upkeep gas limit
    function setNewUpkeepGasLimit(uint32 newUpkeepGasLimit) external;

    /// @notice Update the LINK amount to transfer to new gauge upkeeps
    /// @param newUpkeepFundAmount New upkeep fund amount
    function setNewUpkeepFundAmount(uint96 newUpkeepFundAmount) external;

    /// @notice Set the automation trusted forwarder address
    /// @param trustedForwarder Upkeep trusted forwarder address
    function setTrustedForwarder(address trustedForwarder) external;
}
