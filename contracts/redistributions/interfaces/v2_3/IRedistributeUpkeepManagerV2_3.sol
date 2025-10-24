// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {IRedistributeUpkeepManager} from "../common/IRedistributeUpkeepManager.sol";

interface IRedistributeUpkeepManagerV2_3 is IRedistributeUpkeepManager {
    /// @notice Keeper registry address
    function keeperRegistry() external view returns (address payable);
}
