// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {CronUpkeep} from "@chainlink/contracts/src/v0.8/automation/upkeeps/CronUpkeep.sol";
import {CronUpkeepDelegate} from "@chainlink/contracts/src/v0.8/automation/upkeeps/CronUpkeepDelegate.sol";
import {Spec, Cron as CronExternal} from "@chainlink/contracts/src/v0.8/automation/libraries/external/Cron.sol";
import {ICronUpkeepFactory} from "./interfaces/ICronUpkeepFactory.sol";

contract CronUpkeepFactory is ICronUpkeepFactory {
    /// @inheritdoc ICronUpkeepFactory
    address public immutable override cronDelegate;

    uint256 private constant MAX_JOBS = 1;

    constructor() {
        cronDelegate = address(new CronUpkeepDelegate());
    }

    /// @inheritdoc ICronUpkeepFactory
    function newCronUpkeepWithJob(bytes memory encodedJob) public override returns (address cronUpkeep) {
        cronUpkeep = address(new CronUpkeep(msg.sender, cronDelegate, MAX_JOBS, encodedJob));
        emit NewCronUpkeepCreated(cronUpkeep, msg.sender);
    }

    /// @inheritdoc ICronUpkeepFactory
    function encodeCronJob(
        address target,
        bytes memory handler,
        string memory cronString
    ) external pure override returns (bytes memory) {
        Spec memory spec = CronExternal.toSpec(cronString);
        return abi.encode(target, handler, spec);
    }
}
