// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

contract AutomationRegistrarMock {
    uint256 upkeepId;

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

    event UpkeepRegistered(RegistrationParams requestParams);

    function registerUpkeep(RegistrationParams calldata _requestParams) external returns (uint256) {
        emit UpkeepRegistered(_requestParams);
        return ++upkeepId;
    }
}
