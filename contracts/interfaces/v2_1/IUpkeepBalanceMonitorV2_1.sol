// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {IUpkeepBalanceMonitor} from "../common/IUpkeepBalanceMonitor.sol";

interface IUpkeepBalanceMonitorV2_1 is IUpkeepBalanceMonitor {
    /// @notice Keeper registry address
    function keeperRegistry() external view returns (address);
}
