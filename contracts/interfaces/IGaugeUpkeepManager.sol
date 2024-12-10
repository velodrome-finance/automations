// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

interface IGaugeUpkeepManager {
    event GaugeUpkeepRegistered(address indexed gauge, uint256 indexed upkeepId);
    event GaugeUpkeepCancelled(address indexed gauge, uint256 indexed upkeepId);
    event GaugeUpkeepWithdrawn(uint256 indexed upkeepId);
    event GaugeUpkeepAdminTransferred(uint256 indexed upkeepId, address indexed newAdmin);
    event NewUpkeepGasLimitSet(uint32 newUpkeepGasLimit);
    event NewUpkeepFundAmountSet(uint96 newUpkeepFundAmount);
    event TrustedForwarderSet(address indexed trustedForwarder, bool isTrusted);
    event LinkBalanceWithdrawn(address indexed receiver, uint256 amount);

    error InvalidPerformAction();
    error AutoApproveDisabled();
    error UnauthorizedSender();
    error AddressZeroNotAllowed();

    enum PerformAction {
        REGISTER_UPKEEP,
        CANCEL_UPKEEP
    }

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

    /// @notice Amount of LINK to transfer to upkeep on registration
    function newUpkeepFundAmount() external view returns (uint96);

    /// @notice Gas limit for new upkeeps
    function newUpkeepGasLimit() external view returns (uint32);

    /// @notice Whether an address is a trusted forwarder
    function trustedForwarder(address) external view returns (bool);

    /// @notice Upkeep ID for a gauge
    /// @param _gauge Gauge address
    /// @return Upkeep ID
    function gaugeUpkeepId(address _gauge) external view returns (uint256);

    /// @notice Withdraw remaining upkeep LINK balance to contract balance
    /// @param _upkeepId Gauge upkeep ID owned by the contract
    /// @dev Upkeep must be cancelled before withdrawing
    function withdrawUpkeep(uint256 _upkeepId) external;

    /// @notice Transfer contract LINK balance to owner
    function withdrawLinkBalance() external;

    /// @notice Transfer gauge upkeep admin rights to a new address
    /// @param _upkeepId Upkeep ID
    /// @param _newAdmin New admin address
    function transferUpkeepAdmin(uint256 _upkeepId, address _newAdmin) external;

    /// @notice Update the gas limit for new gauge upkeeps
    /// @param _newUpkeepGasLimit New upkeep gas limit
    function setNewUpkeepGasLimit(uint32 _newUpkeepGasLimit) external;

    /// @notice Update the LINK amount to transfer to new gauge upkeeps
    /// @param _newUpkeepFundAmount New upkeep fund amount
    function setNewUpkeepFundAmount(uint96 _newUpkeepFundAmount) external;

    /// @notice Set the automation trusted forwarder address
    /// @param _trustedForwarder Upkeep trusted forwarder address
    /// @param _isTrusted True to enable trusted forwarder, false to disable
    function setTrustedForwarder(address _trustedForwarder, bool _isTrusted) external;
}
