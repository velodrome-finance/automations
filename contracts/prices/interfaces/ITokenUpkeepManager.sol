// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {Log} from "@chainlink/contracts/src/v0.8/automation/interfaces/ILogAutomation.sol";

interface ITokenUpkeepManager {
    event TokenRegistered(address indexed token);
    event TokenDeregistered(address indexed token);
    event TokenUpkeepRegistered(address indexed tokenUpkeep, uint256 upkeepId, uint256 startIndex, uint256 endIndex);
    event TokenUpkeepCancelled(uint256 upkeepId);
    event TokenUpkeepWithdrawn(uint256 upkeepId);
    event LinkBalanceWithdrawn(address indexed receiver, uint256 amount);
    event NewUpkeepGasLimitSet(uint32 newUpkeepGasLimit);
    event NewUpkeepFundAmountSet(uint96 newUpkeepFundAmount);
    event TrustedForwarderSet(address indexed trustedForwarder);
    event UpkeepBalanceMonitorSet(address indexed upkeepBalanceMonitor);
    event PricesOracleSet(address indexed pricesOracle);
    event FetchedTokenPrice(address indexed token, uint256 price);
    event TokenListCleaned();

    error AutoApproveDisabled();
    error NoLinkBalance();
    error InvalidIndex();
    error UnauthorizedSender();
    error AddressZeroNotAllowed();
    error InvalidAction();

    enum PerformAction {
        RegisterToken,
        DeregisterToken
    }

    /// @notice LINK token address
    function linkToken() external view returns (address);

    /// @notice Keeper registry address
    function keeperRegistry() external view returns (address);

    /// @notice Automation registrar address
    function automationRegistrar() external view returns (address);

    /// @notice Prices contract address
    function pricesOracle() external view returns (address);

    /// @notice Upkeep balance monitor address
    function upkeepBalanceMonitor() external view returns (address);

    /// @notice Trusted forwarder address
    function trustedForwarder() external view returns (address);

    /// @notice Amount to fund new upkeeps with
    function newUpkeepFundAmount() external view returns (uint96);

    /// @notice Gas limit for new upkeeps
    function newUpkeepGasLimit() external view returns (uint32);

    /// @notice Check if address is a token upkeep
    /// @param _address Address to check
    /// @return True if the address is a token upkeep contract
    function isTokenUpkeep(address _address) external view returns (bool);

    /// @notice Get upkeep ID at index
    /// @param _index The index of the upkeep ID
    /// @return The upkeep ID
    function upkeepIds(uint256 _index) external view returns (uint256);

    /// @notice Perform token registration or deregistration
    /// @param _performData Encoded data for the operation
    function performUpkeep(bytes calldata _performData) external;

    /// @notice Fetch token price
    /// @param _token Address of the token
    /// @return Price of the token
    function fetchPrice(address _token) external view returns (uint256);

    /// @notice Store token price (called by token upkeeps)
    /// @param _token Address of the token
    /// @param _price Price of the token
    /// @return True if the price was successfully stored
    function storePrice(address _token, uint256 _price) external returns (bool);

    /// @notice Register multiple tokens
    /// @param _tokens Array of token addresses to register
    function registerTokens(address[] calldata _tokens) external;

    /// @notice Deregister multiple tokens
    /// @param _tokens Array of token addresses to deregister
    function deregisterTokens(address[] calldata _tokens) external;

    /// @notice Cancel upkeeps
    /// @param _startIndex Start index in the upkeeps array
    /// @param _endIndex End index in the upkeeps array
    function cancelUpkeeps(uint256 _startIndex, uint256 _endIndex) external;

    /// @notice Withdraw funds from cancelled upkeeps
    /// @param _startIndex Start index in the cancelled upkeeps array
    /// @param _endIndex End index in the cancelled upkeeps array
    function withdrawCancelledUpkeeps(uint256 _startIndex, uint256 _endIndex) external;

    /// @notice Withdraw LINK balance from the contract
    function withdrawLinkBalance() external;

    /// @notice Cleanup token list by removing empty slots
    function cleanupTokenList() external;

    /// @notice Set gas limit for new upkeeps
    /// @param _newUpkeepGasLimit New gas limit value
    function setNewUpkeepGasLimit(uint32 _newUpkeepGasLimit) external;

    /// @notice Set fund amount for new upkeeps
    /// @param _newUpkeepFundAmount New fund amount value
    function setNewUpkeepFundAmount(uint96 _newUpkeepFundAmount) external;

    /// @notice Set trusted forwarder address
    /// @param _trustedForwarder New trusted forwarder address
    function setTrustedForwarder(address _trustedForwarder) external;

    /// @notice Set upkeep balance monitor address
    /// @param _upkeepBalanceMonitor New upkeep balance monitor address
    function setUpkeepBalanceMonitor(address _upkeepBalanceMonitor) external;

    /// @notice Set prices oracle address
    /// @param _pricesOracle New prices oracle address
    function setPricesOracle(address _pricesOracle) external;

    /// @notice Check log for token registration/deregistration
    /// @param _log The log to check
    /// @return _upkeepNeeded Whether upkeep is needed
    /// @return _performData Data needed for performUpkeep
    function checkLog(
        Log calldata _log,
        bytes memory
    ) external view returns (bool _upkeepNeeded, bytes memory _performData);

    /// @notice Get token at specified index
    /// @param _index The index to query
    /// @return Address of the token at index
    function tokenAt(uint256 _index) external view returns (address);

    /// @notice Get count of registered tokens
    /// @return Number of tokens registered
    function tokenCount() external view returns (uint256);

    /// @notice Get the raw length of the token list
    /// @return Length of the token list including the empty slots
    function tokenListLength() external view returns (uint256);

    /// @notice Get count of registered token upkeeps
    /// @return Number of token upkeeps registered
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
