// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

interface IAutomationRegistrar {
    struct RegistrationParams {
        string name;
        bytes encryptedEmail;
        address upkeepContract;
        uint32 gasLimit;
        address adminAddress;
        uint8 triggerType;
        bytes checkData;
        bytes triggerConfig;
        bytes offchainConfig;
        uint96 amount;
    }

    /// @notice Register an upkeep
    /// @param _requestParams The parameters for the upkeep registration
    /// @return The ID of the upkeep
    function registerUpkeep(RegistrationParams calldata _requestParams) external returns (uint256);
}
