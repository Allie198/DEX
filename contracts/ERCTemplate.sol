// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERCTemplate is ERC20 {
    constructor (
        string  memory name_, 
        string  memory symbol_, 
        uint256 supply_, 
        address to_
    ) ERC20 (name_, symbol_) {
        _mint(to_, supply_);
    }
}