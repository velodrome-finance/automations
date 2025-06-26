// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {IGaugeUpkeepManager} from "../common/IGaugeUpkeepManager.sol";

interface IGaugeUpkeepManagerV2_1 is IGaugeUpkeepManager {
    /// @notice Keeper registry address
    function keeperRegistry() external view returns (address);
}
