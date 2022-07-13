// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "hardhat/console.sol";

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
// import 'https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC20/ERC20.sol';

contract MockToken is ERC20 {
    constructor() ERC20('MockToken', "MTK") {
        _mint(msg.sender, 100000 * 10**18);
    }

    function faucet(uint amount) external {
        _mint(msg.sender, amount);
    }
}