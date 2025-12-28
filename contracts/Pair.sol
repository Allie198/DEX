// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Pair is ERC20 {
    using SafeERC20 for IERC20;

    address internal constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    address public immutable tokenA;
    address public immutable tokenB;

    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    uint112 public reserveA;
    uint112 public reserveB;

    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant FEE_BPS_MIN = 10;
    uint256 public constant FEE_BPS_BASE = 30;
    uint256 public constant FEE_BPS_MAX = 100;

    event AddLiquidity(address indexed user, uint256 amountA, uint256 amountB, uint256 LP);
    event RemoveLiquidity(address indexed user, uint256 amountA, uint256 amountB, uint256 LP);
    event Swap(address indexed user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, address to);

    constructor(address a, address b) ERC20("LP token", "LP") {
        require(a != address(0) && b != address(0), "ZERO");
        require(a != b, "SAME");
        (tokenA, tokenB) = a < b ? (a, b) : (b, a);
    }

    function getReserves() public view returns (uint112, uint112) {
        return (reserveA, reserveB);
    }

    function addLiquidity(uint256 amountAIn, uint256 amountBIn, address to) external returns (uint256 LP) {
        require(amountAIn > 0 && amountBIn > 0, "AMOUNTS");
        require(to != address(0), "TO0");

        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountAIn);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountBIn);

        uint256 _totalSupply = totalSupply();

        if (_totalSupply == 0) {
            uint256 liquidity = _sqrt(amountAIn * amountBIn);
            require(liquidity > MINIMUM_LIQUIDITY, "MIN_LIQ");
            _mint(BURN_ADDRESS, MINIMUM_LIQUIDITY);
            LP = liquidity - MINIMUM_LIQUIDITY;
        } else {
            require(reserveA > 0 && reserveB > 0, "R0");
            LP = _min((amountAIn * _totalSupply) / reserveA, (amountBIn * _totalSupply) / reserveB);
            require(LP > 0, "LP0");
        }

        _mint(to, LP);
        _sync();

        emit AddLiquidity(msg.sender, amountAIn, amountBIn, LP);
    }

    function removeLiquidity(uint256 lp) external returns (uint256 amountAOut, uint256 amountBOut) {
        require(lp > 0, "LP0");

        uint256 _totalSupply = totalSupply();
        require(_totalSupply > 0, "TS0");

        amountAOut = (lp * reserveA) / _totalSupply;
        amountBOut = (lp * reserveB) / _totalSupply;

        require(amountAOut > 0 || amountBOut > 0, "OUT0");

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
        require(reserveA > 0 && reserveB > 0, "R0");

        bool isA = (tokenIn == tokenA);
        address tokenOut = isA ? tokenB : tokenA;
        (uint256 rIn, uint256 rOut) = isA ? (uint256(reserveA), uint256(reserveB)) : (uint256(reserveB), uint256(reserveA));

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 feeBps = _dynamicFeeBps(amountIn, rIn);
        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - feeBps);
        amountOut = (amountInWithFee * rOut) / (rIn * FEE_DENOMINATOR + amountInWithFee);

        require(amountOut >= minOut && amountOut > 0, "SLIPPAGE");

        IERC20(tokenOut).safeTransfer(to, amountOut);

        _sync();
        emit Swap(msg.sender, tokenIn, tokenOut, amountIn, amountOut, to);
    }

    function quoteOut(address tokenIn, uint256 amountIn) external view returns (uint256 amountOut) {
        require(tokenIn == tokenA || tokenIn == tokenB, "TOKEN");
        require(amountIn > 0, "IN0");
        require(reserveA > 0 && reserveB > 0, "R0");

        bool isA = (tokenIn == tokenA);
        (uint256 reserveIn, uint256 reserveOut) = isA ? (uint256(reserveA), uint256(reserveB)) : (uint256(reserveB), uint256(reserveA));

        uint256 feeBps = _dynamicFeeBps(amountIn, reserveIn);
        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - feeBps);
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * FEE_DENOMINATOR + amountInWithFee);
    }

    function feeBpsFor(uint256 amountIn, address tokenIn) external view returns (uint256 feeBps) {
        require(tokenIn == tokenA || tokenIn == tokenB, "TOKEN");
        uint256 reserveIn = tokenIn == tokenA ? uint256(reserveA) : uint256(reserveB);
        feeBps = _dynamicFeeBps(amountIn, reserveIn);
    }

    function _dynamicFeeBps(uint256 amountIn, uint256 reserveIn) internal pure returns (uint256 feeBps) {
        if (reserveIn == 0) return FEE_BPS_MAX;
        uint256 impactBps = (amountIn * FEE_DENOMINATOR) / (reserveIn + amountIn);
        uint256 extra = impactBps / 25;
        feeBps = FEE_BPS_BASE + extra;
        if (feeBps < FEE_BPS_MIN) feeBps = FEE_BPS_MIN;
        if (feeBps > FEE_BPS_MAX) feeBps = FEE_BPS_MAX;
    }

    function _sync() internal {
        uint256 balA = IERC20(tokenA).balanceOf(address(this));
        uint256 balB = IERC20(tokenB).balanceOf(address(this));
        require(balA <= type(uint112).max && balB <= type(uint112).max, "BAL112");
        reserveA = uint112(balA);
        reserveB = uint112(balB);
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
