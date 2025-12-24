// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Pair {
    address public immutable tokenA;
    address public immutable tokenB;

    uint112 public reserveA;
    uint112 public reserveB;

    mapping (address => uint256) public balanceOF;
    uint256 public totalSupply;

    event AddLiquidity   (address indexed user, uint256 amountA, uint256 amountB,  uint256 LP);
    event RemoveLiquidity(address indexed user, uint256 amountA, uint256 amountB,  uint256 LP);
    event Swap           (address indexed user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);

    constructor (address a, address b) {
        require (a != b, "Both addresses are same");
        (tokenA, tokenB) = a < b ? (a, b) : (b, a);
    }

    function getReserves() external view returns (uint112, uint112) {
        return (reserveA, reserveB);
    }

    function addLiquidity(uint256 amountA, uint256 amountB) external returns(uint256 LP) { 
        require(amountA > 0 && amountB > 0, "Amounts must be greater than zero");

        IERC20(tokenA).transferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).transferFrom(msg.sender, address(this), amountB);

        if (totalSupply == 0) {
            LP = _sqrt(amountA * amountB);
        } else {
            LP = _min((amountA * totalSupply) / reserveA, (amountB * totalSupply) / reserveB);
        }

        require(LP > 0 , "LP cannot be 0");

        balanceOF[msg.sender] += LP;
        totalSupply += LP; 

        _sync();

        emit AddLiquidity(msg.sender, amountA, amountB, LP);
    }

    function removeLiquidity(uint256 LP) external returns (uint256 amountA, uint256 amountB) {
        require(LP > 0, "LP cannot be 0");
        require(balanceOF[msg.sender] >= LP, "Your must be greater than or equal to LP");

        amountA = (LP * reserveA) / totalSupply;
        amountB = (LP * reserveB) / totalSupply;

        balanceOF[msg.sender] -= LP;
        totalSupply -= LP; 

        IERC20(tokenA).transfer(msg.sender, amountA);
        IERC20(tokenB).transfer(msg.sender, amountB);

        _sync();

        emit RemoveLiquidity(msg.sender, amountA, amountB, LP);
    }

    function swap(address tokenIn, uint256 amountIn, uint256 minOut) external returns (uint256 amountOut) {
        require(tokenIn == tokenA || tokenIn == tokenB, "Token");
        require(amountIn > 0, "Amount cannot be 0");

        bool isA = tokenA == tokenIn;
        address tokenOut = isA ? tokenB : tokenA;

        (uint256 rIn, uint256 rOut) = isA ? (reserveA, reserveB) : (reserveB, reserveA);
        
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        uint256 amountInWithFee = amountIn * 997; 
        
        amountOut = (amountInWithFee * rOut) / (rIn * 1000 + amountInWithFee);
        require(amountOut >= minOut && amountOut > 0, "SLIPPAGE");

        IERC20(tokenOut).transfer(msg.sender, amountOut);

        _sync();
        emit Swap(msg.sender, tokenIn, tokenOut, amountIn, amountOut);

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

