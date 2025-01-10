// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

interface IUpkeepBalanceMonitor {
    /// @member maxBatchSize is the maximum number of upkeeps to fund in a single transaction
    /// @member minPercentage is the percentage of the upkeep's minBalance at which top-up occurs
    /// @member targetPercentage is the percentage of the upkeep's minBalance to top-up to
    /// @member maxTopUpAmount is the maximum amount of LINK to top-up an upkeep with
    struct Config {
        uint8 maxBatchSize;
        uint24 minPercentage;
        uint24 targetPercentage;
        uint96 maxTopUpAmount;
    }

    event ConfigSet(Config config);
    event ForwarderSet(address forwarderAddress);
    event FundsWithdrawn(uint256 amountWithdrawn, address payee);
    event TopUpFailed(uint256 indexed upkeepId);
    event TopUpSucceeded(uint256 indexed upkeepId, uint96 amount);

    error InvalidConfig();
    error InvalidTopUpData();
    error OnlyForwarderOrOwner();
    error AddressZeroNotAllowed();

    /// @notice Gauge upkeep manager address
    function gaugeUpkeepManager() external view returns (address);

    /// @notice Keeper registry address
    function keeperRegistry() external view returns (address);

    /// @notice LINK token address
    function linkToken() external view returns (address);

    /// @notice Gets the upkeep's forwarder contract
    function forwarderAddress() external view returns (address);

    /// @notice Gets a list of upkeeps that are underfunded
    /// @return _needsFunding list of underfunded upkeepIDs
    /// @return _topUpAmounts amount to top up each upkeep
    function getUnderfundedUpkeeps()
        external
        view
        returns (uint256[] memory _needsFunding, uint96[] memory _topUpAmounts);

    /// @notice Called by the keeper/owner to send funds to underfunded upkeeps
    /// @param _upkeepIds the list of upkeep ids to fund
    /// @param _topUpAmounts the list of amounts to fund each upkeep with
    function topUp(uint256[] memory _upkeepIds, uint96[] memory _topUpAmounts) external;

    /// @notice Gets list of upkeeps ids that are underfunded and returns a keeper-compatible payload.
    /// @return _upkeepNeeded signals if upkeep is needed
    /// @return _performData is an abi encoded list of subscription ids that need funds
    function checkUpkeep(bytes calldata) external view returns (bool _upkeepNeeded, bytes memory _performData);

    /// @notice Called by the keeper to send funds to underfunded addresses.
    /// @param _performData the abi encoded list of upkeeps to fund
    function performUpkeep(bytes calldata _performData) external;

    /// @notice Withdraws the contract balance in LINK.
    /// @param _amount the amount of LINK (in juels) to withdraw
    /// @param _payee the address to pay
    function withdraw(uint256 _amount, address _payee) external;

    /// @notice Pause the contract, which prevents executing performUpkeep.
    function pause() external;

    /// @notice Unpause the contract.
    function unpause() external;

    /// @notice Sets the contract config
    /// @param _config the new config
    /// @dev Config must adhere to validation rules: maxBatchSize > 0, minPercentage >= 100,
    /// targetPercentage > minPercentage, and maxTopUpAmount > 0.
    function setConfig(Config memory _config) external;

    /// @notice Sets the upkeep's forwarder contract
    /// @param _trustedForwarder the new forwarder
    /// @dev this should only need to be called once, after registering the contract with the registry
    function setTrustedForwarder(address _trustedForwarder) external;

    /// @notice Gets the contract config
    /// @return _config the current contract configuration
    function getConfig() external view returns (Config memory _config);
}
