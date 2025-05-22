// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {ITokenUpkeepManager} from "../common/ITokenUpkeepManager.sol";

interface ITokenUpkeepManagerV2_3 is ITokenUpkeepManager {
    /// @notice Keeper registry address
    function keeperRegistry() external view returns (address payable);
}
