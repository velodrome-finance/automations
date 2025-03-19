// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IAutomationRegistrarV2_3 {
    struct RegistrationParams {
        address upkeepContract;
        uint96 amount;
        address adminAddress;
        uint32 gasLimit;
        uint8 triggerType;
        IERC20 billingToken;
        string name;
        bytes encryptedEmail;
        bytes checkData;
        bytes triggerConfig;
        bytes offchainConfig;
    }

    /// @notice Register an upkeep
    /// @param _requestParams The parameters for the upkeep registration
    /// @return The ID of the upkeep
    function registerUpkeep(RegistrationParams calldata _requestParams) external returns (uint256);
}
