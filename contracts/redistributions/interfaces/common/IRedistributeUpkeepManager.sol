// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {Log} from "@chainlink/contracts/src/v0.8/automation/interfaces/ILogAutomation.sol";

interface IRedistributeUpkeepManager {
    event GaugeRegistered(address indexed gauge);
    event GaugeDeregistered(address indexed gauge);
    event RedistributeUpkeepRegistered(
        address indexed redistributeUpkeep,
        uint256 indexed upkeepId,
        uint256 indexed startIndex,
        uint256 endIndex
    );
    event RedistributeUpkeepCancelled(uint256 indexed upkeepId);
    event RedistributeUpkeepWithdrawn(uint256 indexed upkeepId);
    event BatchSizeSet(uint8 batchSize);
    event NewUpkeepGasLimitSet(uint32 newUpkeepGasLimit);
    event NewUpkeepFundAmountSet(uint96 newUpkeepFundAmount);
    event TrustedForwarderSet(address indexed trustedForwarder, bool isTrusted);
    event UpkeepBalanceMonitorSet(address indexed upkeepBalanceMonitor);
    event ExcludedGaugeFactorySet(address indexed gaugeFactory, bool isExcluded);
    event LinkBalanceWithdrawn(address indexed receiver, uint256 amount);

    error InvalidPerformAction();
    error AutoApproveDisabled();
    error UnauthorizedSender();
    error AddressZeroNotAllowed();
    error NoLinkBalance();
    error NotGauge(address gauge);
    error GaugeNotAlive(address gauge);
    error GaugeNotAllowed(address gauge);
    error RedistributeUpkeepExists(address gauge);
    error RedistributeUpkeepNotFound(address gauge);
    error InvalidBatchSize();
    error InvalidIndex();

    enum PerformAction {
        REGISTER_GAUGE,
        DEREGISTER_GAUGE
    }

    /// @notice LINK token address
    function linkToken() external view returns (address);

    /// @notice Automation registrar address
    function automationRegistrar() external view returns (address);

    /// @notice Upkeep balance monitor address
    function upkeepBalanceMonitor() external view returns (address);

    /// @notice Voter address
    function voter() external view returns (address);

    /// @notice Address of the CL Gauge Factory with emission cap support
    function clGaugeFactory() external view returns (address);

    /// @notice Factory registry address
    function factoryRegistry() external view returns (address);

    /// @notice Amount of LINK to transfer to upkeep on registration
    function newUpkeepFundAmount() external view returns (uint96);

    /// @notice Gas limit for new upkeeps
    function newUpkeepGasLimit() external view returns (uint32);

    /// @notice Number of gauges processed per distribute call
    function batchSize() external view returns (uint8);

    /// @notice Whether an address is a trusted forwarder
    /// @param _forwarder Forwarder address
    /// @return True if set as trusted forwarder, false otherwise
    function trustedForwarder(address _forwarder) external view returns (bool);

    /// @notice Whether a gauge factory is excluded
    /// @param _gaugeFactory Gauge factory address
    /// @return True if the gauge factory is excluded
    function excludedGaugeFactory(address _gaugeFactory) external view returns (bool);

    /// @notice Gets an item from the registered upkeeps
    /// @param _index Index of the upkeep IDs array
    /// @return Upkeep ID
    function upkeepIds(uint256 _index) external view returns (uint256);

    /// @notice Perform the upkeep action according to the performData passed from checkLog
    /// @param _performData the data which was passed back from the checkLog simulation
    /// @dev This function is called by the automation network to perform the upkeep action
    function performUpkeep(bytes calldata _performData) external;

    /// @notice Register gauges in bulk
    /// @param _gauges Array of gauge addresses
    function registerGauges(address[] calldata _gauges) external;

    /// @notice Deregister gauges in bulk
    /// @param _gauges Array of gauge addresses
    function deregisterGauges(address[] calldata _gauges) external;

    /// @notice Withdraw remaining upkeep LINK balance from cancelled upkeeps to contract balance
    /// @param _startIndex Start index from the cancelled upkeeps array
    /// @param _endIndex End index from the cancelled upkeeps array
    function withdrawCancelledUpkeeps(uint256 _startIndex, uint256 _endIndex) external;

    /// @notice Transfer contract LINK balance to owner
    function withdrawLinkBalance() external;

    /// @notice Update the gas limit for new redistribute upkeeps
    /// @param _newUpkeepGasLimit New upkeep gas limit
    function setNewUpkeepGasLimit(uint32 _newUpkeepGasLimit) external;

    /// @notice Update the LINK amount to transfer to new redistribute upkeeps
    /// @param _newUpkeepFundAmount New upkeep fund amount
    function setNewUpkeepFundAmount(uint96 _newUpkeepFundAmount) external;

    /// @notice Update the number of gauges processed per distribute call
    /// @param _batchSize New batch size
    function setBatchSize(uint8 _batchSize) external;

    /// @notice Set the automation trusted forwarder address
    /// @param _trustedForwarder Upkeep trusted forwarder address
    /// @param _isTrusted True to enable trusted forwarder, false to disable
    function setTrustedForwarder(address _trustedForwarder, bool _isTrusted) external;

    /// @notice Set the upkeep balance monitor address
    /// @param _upkeepBalanceMonitor Upkeep balance monitor contract address
    function setUpkeepBalanceMonitor(address _upkeepBalanceMonitor) external;

    /// @notice Set an excluded gauge factory address
    /// @param _gaugeFactory Gauge factory address
    /// @param _isExcluded Whether the gauge factory should be excluded or not
    function setExcludedGaugeFactory(address _gaugeFactory, bool _isExcluded) external;

    /// @notice Called by the automation DON when a new log is emitted by the target contract
    /// @param _log the raw log data matching the filter that this contract has registered as a trigger
    /// @dev This function is called by the automation DON to check if any action is needed
    /// @return _upkeepNeeded True if any action is needed according to the log
    /// @return _performData Encoded action and data passed to performUpkeep if upkeepNeeded is true
    function checkLog(
        Log calldata _log,
        bytes memory
    ) external view returns (bool _upkeepNeeded, bytes memory _performData);

    /// @notice Gets a range of gauge addresses
    /// @param _startIndex Start index of the gauge list
    /// @param _endIndex End index of the gauge list
    /// @return Array of gauge addresses
    function gaugeList(uint256 _startIndex, uint256 _endIndex) external view returns (address[] memory);

    /// @notice Gets the number of gauges registered with the contract
    /// @return Number of gauges
    function gaugeCount() external view returns (uint256);

    /// @notice Gets the number of registered redistribute upkeeps
    /// @return Number of redistribute upkeeps
    function upkeepCount() external view returns (uint256);

    /// @notice Gets a range of cancelled upkeeps pending withdrawal
    /// @param _startIndex Start index of the cancelled upkeeps array
    /// @param _endIndex End index of the cancelled upkeeps array
    /// @return Array of cancelled upkeep IDs
    function cancelledUpkeeps(uint256 _startIndex, uint256 _endIndex) external view returns (uint256[] memory);

    /// @notice Gets the number of cancelled upkeeps pending withdrawal
    /// @return Number of cancelled upkeeps
    function cancelledUpkeepCount() external view returns (uint256);
}
