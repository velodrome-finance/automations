// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

interface IGaugeUpkeepManager {
    event GaugeRegistered(address indexed gauge);
    event GaugeDeregistered(address indexed gauge);
    event GaugeUpkeepCreated(address indexed gauge, uint256 indexed startIndex, uint256 indexed endIndex);
    event GaugeUpkeepRegistered(address indexed gaugeUpkeep, uint256 indexed upkeepId);
    event GaugeUpkeepCancelled(uint256 indexed upkeepId);
    event GaugeUpkeepWithdrawn(uint256 indexed upkeepId);
    event NewUpkeepGasLimitSet(uint32 newUpkeepGasLimit);
    event NewUpkeepFundAmountSet(uint96 newUpkeepFundAmount);
    event TrustedForwarderSet(address indexed trustedForwarder, bool isTrusted);
    event UpkeepBalanceMonitorSet(address indexed upkeepBalanceMonitor);
    event LinkBalanceWithdrawn(address indexed receiver, uint256 amount);

    error InvalidPerformAction();
    error AutoApproveDisabled();
    error UnauthorizedSender();
    error AddressZeroNotAllowed();
    error NoLinkBalance();
    error NotGauge(address gauge);
    error CrosschainGaugeNotAllowed(address gauge);
    error GaugeUpkeepExists(address gauge);
    error GaugeUpkeepNotFound(address gauge);

    enum PerformAction {
        REGISTER_GAUGE,
        DEREGISTER_GAUGE
    }

    /// @notice LINK token address
    function linkToken() external view returns (address);

    /// @notice Keeper registry address
    function keeperRegistry() external view returns (address);

    /// @notice Automation registrar address
    function automationRegistrar() external view returns (address);

    /// @notice Upkeep balance monitor address
    function upkeepBalanceMonitor() external view returns (address);

    /// @notice Voter address
    function voter() external view returns (address);

    /// @notice Factory registry address
    function factoryRegistry() external view returns (address);

    /// @notice Amount of LINK to transfer to upkeep on registration
    function newUpkeepFundAmount() external view returns (uint96);

    /// @notice Gas limit for new upkeeps
    function newUpkeepGasLimit() external view returns (uint32);

    /// @notice Whether an address is a trusted forwarder
    /// @param _forwarder Forwarder address
    /// @return True if set as trusted forwarder, false otherwise
    function trustedForwarder(address _forwarder) external view returns (bool);

    /// @notice Whether a gauge factory is a crosschain factory
    /// @param _gaugeFactory Gauge factory address
    /// @return True if the gauge factory is a crosschain factory
    function crosschainGaugeFactory(address _gaugeFactory) external view returns (bool);

    /// @notice Gets an item from the registered upkeeps
    /// @param _index Index of the upkeep IDs array
    /// @return Upkeep ID
    function upkeepIds(uint256 _index) external view returns (uint256);

    /// @notice Withdraw remaining upkeep LINK balance to contract balance
    /// @param _upkeepId Gauge upkeep ID owned by the contract
    /// @dev Upkeep must be cancelled before withdrawing
    function withdrawUpkeep(uint256 _upkeepId) external;

    /// @notice Transfer contract LINK balance to owner
    function withdrawLinkBalance() external;

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

    /// @notice Set the upkeep balance monitor address
    /// @param _upkeepBalanceMonitor Upkeep balance monitor contract address
    function setUpkeepBalanceMonitor(address _upkeepBalanceMonitor) external;

    /// @notice Register gauges in bulk
    /// @param _gauges Array of gauge addresses
    function registerGauges(address[] calldata _gauges) external;

    /// @notice Deregister gauges in bulk
    /// @param _gauges Array of gauge addresses
    function deregisterGauges(address[] calldata _gauges) external;

    /// @notice Gets the number of gauges registered with the contract
    /// @return Number of gauges
    function gaugeCount() external view returns (uint256);

    /// @notice Gets a range of gauge addresses
    /// @param _startIndex Start index of the gauge list
    /// @param _endIndex End index of the gauge list
    /// @return Array of gauge addresses
    function gaugeList(uint256 _startIndex, uint256 _endIndex) external view returns (address[] memory);

    /// @notice Gets the number of registered gauge upkeeps
    /// @return Number of gauge upkeeps
    function upkeepCount() external view returns (uint256);
}
