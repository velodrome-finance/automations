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
    function newCronUpkeep(
        address _target,
        bytes memory _handler,
        string memory _cronString
    ) public override returns (address cronUpkeep) {
        bytes memory encodedJob = _encodeCronJob(_target, _handler, _cronString);
        cronUpkeep = address(new CronUpkeep(msg.sender, cronDelegate, MAX_JOBS, encodedJob));
        emit NewCronUpkeepCreated(cronUpkeep, msg.sender);
    }

    function _encodeCronJob(
        address _target,
        bytes memory _handler,
        string memory _cronString
    ) internal pure returns (bytes memory) {
        Spec memory spec = CronExternal.toSpec(_cronString);
        return abi.encode(_target, _handler, spec);
    }
}
