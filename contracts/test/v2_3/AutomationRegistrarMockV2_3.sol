// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract AutomationRegistrarMockV2_3 {
    uint256 upkeepId;

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

    event UpkeepRegistered(RegistrationParams requestParams);

    function registerUpkeep(RegistrationParams calldata _requestParams) external returns (uint256) {
        emit UpkeepRegistered(_requestParams);
        return ++upkeepId;
    }
}
