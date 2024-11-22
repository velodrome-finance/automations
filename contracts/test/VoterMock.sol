// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract VoterMock {
    event WhitelistToken(address indexed whitelister, address indexed token, bool indexed _bool);

    function whitelistToken(address token) external {
        emit WhitelistToken(msg.sender, token, true);
    }
}
