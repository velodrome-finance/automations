// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

contract KeeperRegistryMock {
    mapping(uint256 => uint96) public balances;
    mapping(uint256 => uint96) public minBalances;

    address public forwarder;

    event UpkeepCancelled(uint256 id);
    event UpkeepWithdrawn(uint256 id, address to);

    function setBalance(uint256 _id, uint96 _balance) external {
        balances[_id] = _balance;
    }

    function setMinBalance(uint256 _id, uint96 _minBalance) external {
        minBalances[_id] = _minBalance;
    }

    function setForwarder(address _forwarder) external {
        forwarder = _forwarder;
    }

    function getBalance(uint256 _id) external view returns (uint96) {
        return balances[_id];
    }

    function getMinBalance(uint256 _id) external view returns (uint96) {
        return minBalances[_id];
    }

    function getForwarder(uint256) external view returns (address) {
        return forwarder;
    }

    function cancelUpkeep(uint256 _id) external {
        emit UpkeepCancelled(_id);
    }

    function withdrawFunds(uint256 _id, address _to) external {
        emit UpkeepWithdrawn(_id, _to);
    }
}
