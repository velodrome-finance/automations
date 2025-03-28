// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

interface ITokenUpkeep {
    event TokenUpkeepPerformed(uint256 indexed currentIndex, bool indexed success);
    event TrustedForwarderSet(address indexed trustedForwarder);

    error UpkeepNotNeeded();
    error UnauthorizedSender();
    error AddressZeroNotAllowed();

    /// @notice Address of the Prices contract
    function pricesContract() external view returns (address);

    /// @notice Address of the token upkeep manager
    function tokenUpkeepManager() external view returns (address);

    /// @notice The start index (inclusive) for this upkeep in the token list
    function startIndex() external view returns (uint256);

    /// @notice The end index (exclusive) for this upkeep in the token list
    function endIndex() external view returns (uint256);

    /// @notice The current index of token to be processed
    function currentIndex() external view returns (uint256);

    /// @notice The last hour timestamp when the upkeep was performed
    function lastRun() external view returns (uint256);

    /// @notice The address of the trusted forwarder
    function trustedForwarder() external view returns (address);

    /// @notice Sets the trusted forwarder address
    /// @param _trustedForwarder The new trusted forwarder address
    function setTrustedForwarder(address _trustedForwarder) external;

    /// @notice Performs the upkeep, updating token prices
    /// @param _performData The data to be used for the upkeep
    function performUpkeep(bytes calldata _performData) external;

    /// @notice Validates if upkeep is needed for token price updates
    /// @return _upkeepNeeded Boolean indicating if upkeep is needed
    /// @return _performData Encoded token address and price fetched data
    function checkUpkeep(bytes calldata) external view returns (bool _upkeepNeeded, bytes memory _performData);
}
