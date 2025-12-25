// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Pair is ERC20 {
    using SafeERC20 for IERC20;

    address public immutable tokenA;
    address public immutable tokenB;

    uint112 public reserveA;
    uint112 public reserveB;

    event AddLiquidity   (address indexed user, uint256 amountA, uint256 amountB,  uint256 LP);
    event RemoveLiquidity(address indexed user, uint256 amountA, uint256 amountB,  uint256 LP);
    event Swap           (address indexed user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, address to);

    constructor (address a, address b) ERC20("LP token", "LP"){
        require (a != b, "Both addresses are same");
        (tokenA, tokenB) = a < b ? (a, b) : (b, a);
    }

    function getReserves() public view returns (uint112, uint112) {
        return (reserveA, reserveB);
    }

    function addLiquidity(uint256 amountAIn, uint256 amountBIn) external returns (uint256 lp) {
        require(amountAIn > 0 && amountBIn > 0, "AMOUNTS");

        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountAIn);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountBIn);

        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            lp = _sqrt(amountAIn * amountBIn);
        } else {
            lp = _min((amountAIn * _totalSupply) / reserveA, (amountBIn * _totalSupply) / reserveB);
        }
        require(lp > 0, "LP0");

        _mint(msg.sender, lp);
        _sync();

        emit AddLiquidity(msg.sender, amountAIn, amountBIn, lp);
    }

      function removeLiquidity(uint256 lp) external returns (uint256 amountAOut, uint256 amountBOut) {
        require(lp > 0, "LP0");

        uint256 _totalSupply = totalSupply();
        // LP token, Pair'in ERC20'si olduğu için user balance kontrolü ERC20 içinden gelir.
        amountAOut = (lp * reserveA) / _totalSupply;
        amountBOut = (lp * reserveB) / _totalSupply;

        _burn(msg.sender, lp);

        IERC20(tokenA).safeTransfer(msg.sender, amountAOut);
        IERC20(tokenB).safeTransfer(msg.sender, amountBOut);

        _sync();
        emit RemoveLiquidity(msg.sender, amountAOut, amountBOut, lp);
    }
 
    function swap(address tokenIn, uint256 amountIn, uint256 minOut, address to) external returns (uint256 amountOut) {
        require(tokenIn == tokenA || tokenIn == tokenB, "TOKEN");
        require(amountIn > 0, "IN0");
        require(to != address(0), "TO0");

        bool isA = (tokenIn == tokenA);
        address tokenOut = isA ? tokenB : tokenA;
        (uint256 rIn, uint256 rOut) = isA ? (reserveA, reserveB) : (reserveB, reserveA);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 amountInWithFee = amountIn * 997; // %0.3
        amountOut = (amountInWithFee * rOut) / (rIn * 1000 + amountInWithFee);

        require(amountOut >= minOut && amountOut > 0, "SLIPPAGE");

        IERC20(tokenOut).safeTransfer(to, amountOut);

        _sync();
        emit Swap(msg.sender, tokenIn, tokenOut, amountIn, amountOut, to);
    }


    function _sync() internal {
        reserveA = uint112(IERC20(tokenA).balanceOf(address(this)));
        reserveB = uint112(IERC20(tokenB).balanceOf(address(this)));
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) { 
        return a < b ? a : b; 
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) { z = x; x = (y / x + x) / 2; }
        } else if (y != 0) z = 1;
    }
}
 