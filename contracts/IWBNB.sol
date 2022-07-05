// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IWBNB {
    function name() external view returns(string memory);
    function totalSupply() external view returns(uint);
    function decimals() external view returns(uint8);
    function balanceOf(address owner) external view returns(uint);
    function symbol() external view returns(string memory);
    function allowance(address owner, address spender) external view returns(uint);

    function approve(address spender, uint amount) external;
    function transferFrom(address from, address to, uint amount) external returns(bool);
    function withdraw(uint amount) external;
    function transfer(address to, uint amount) external returns(bool);
    function deposit() external payable;
}