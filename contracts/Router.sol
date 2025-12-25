// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./Factory.sol";
import "./Pair.sol";

contract Router {
    using SafeERC20 for IERC20;

    Factory public immutable factory;

    constructor(address _factory) {
        require(_factory != address(0), "FACTORY0");
        factory = Factory(_factory);
    }

  
    struct AddLiqVars {
        address pair;
        address t0;
        uint112 r0;
        uint112 r1;
        uint256 d0;
        uint256 d1;
        uint256 m0;
        uint256 m1;
        uint256 a0;
        uint256 a1;
        uint256 amountA;
        uint256 amountB;
        uint256 lp;
    }
 
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 desiredA,
        uint256 desiredB,
        uint256 minA,
        uint256 minB
    )
        external
        returns (address pair, uint256 amountA, uint256 amountB, uint256 lp)
    {
        require(tokenA != tokenB, "SAME");
        require(tokenA != address(0) && tokenB != address(0), "ZERO");
        require(desiredA > 0 && desiredB > 0, "DES0");

        AddLiqVars memory v;

        v.pair = _getOrCreatePair(tokenA, tokenB);
        v.t0 = Pair(v.pair).tokenA(); 
        (v.r0, v.r1) = Pair(v.pair).getReserves();

 
        (v.d0, v.d1) = _toPairOrder(tokenA, v.t0, desiredA, desiredB);
        (v.m0, v.m1) = _toPairOrder(tokenA, v.t0, minA, minB);
 
        (v.a0, v.a1) = _optimal(v.d0, v.d1, v.m0, v.m1, v.r0, v.r1);
 
        (v.amountA, v.amountB) = _fromPairOrder(tokenA, v.t0, v.a0, v.a1);
 
        _pull(tokenA, msg.sender, v.amountA);
        _pull(tokenB, msg.sender, v.amountB);

 
        _approveIfNeeded(tokenA, v.pair, v.amountA);
        _approveIfNeeded(tokenB, v.pair, v.amountB);

 
        v.lp = Pair(v.pair).addLiquidity(v.a0, v.a1);

 
        _refundDust(tokenA, msg.sender);
        _refundDust(tokenB, msg.sender);

        return (v.pair, v.amountA, v.amountB, v.lp);
    }
 
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 lp,
        uint256 minA,
        uint256 minB,
        address to
    )
        external
        returns (uint256 amountA, uint256 amountB)
    {
        require(to != address(0), "TO0");
        require(lp > 0, "LP0");

        address pair = factory.getPair(tokenA, tokenB);
        require(pair != address(0), "PAIR0");


        IERC20(pair).safeTransferFrom(msg.sender, address(this), lp);
        (uint256 out0, uint256 out1) = Pair(pair).removeLiquidity(lp);

        address t0 = Pair(pair).tokenA();
        (amountA, amountB) = _fromPairOrder(tokenA, t0, out0, out1);

        require(amountA >= minA, "A_MIN");
        require(amountB >= minB, "B_MIN");

        IERC20(tokenA).safeTransfer(to, amountA);
        IERC20(tokenB).safeTransfer(to, amountB);
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to
    )
        external
        returns (uint256[] memory amounts)
    {
        require(path.length >= 2, "PATH");
        require(to != address(0), "TO0");
        require(amountIn > 0, "IN0");

        amounts = getAmountsOut(amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "SLIPPAGE");

        _pull(path[0], msg.sender, amounts[0]);

        for (uint256 i = 0; i < path.length - 1; i++) {
            address input = path[i];
            address output = path[i + 1];

            address pair = factory.getPair(input, output);
            require(pair != address(0), "PAIR_MISSING");

            _approveIfNeeded(input, pair, amounts[i]);
            address hopTo = (i == path.length - 2) ? to : address(this);
            Pair(pair).swap(input, amounts[i], 0, hopTo);
        }
    }

    function getAmountsOut(uint256 amountIn, address[] memory path)
        public
        view
        returns (uint256[] memory amounts)
    {
        require(path.length >= 2, "PATH");

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;

        for (uint256 i = 0; i < path.length - 1; i++) {
            address pair = factory.getPair(path[i], path[i + 1]);
            require(pair != address(0), "PAIR_MISSING");

            (uint256 rIn, uint256 rOut) = _reservesFor(pair, path[i]);
            amounts[i + 1] = getAmountOut(amounts[i], rIn, rOut);
        }
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        public
        pure
        returns (uint256 out)
    {
        require(amountIn > 0, "IN0");
        require(reserveIn > 0 && reserveOut > 0, "R0");
        uint256 inWithFee = amountIn * 997; // 0.3% fee
        out = (inWithFee * reserveOut) / (reserveIn * 1000 + inWithFee);
    }

    function _getOrCreatePair(address tokenA, address tokenB) internal returns (address pair) {
        pair = factory.getPair(tokenA, tokenB);
        if (pair == address(0)) pair = factory.createPair(tokenA, tokenB);
    }

    function _reservesFor(address pair, address input) internal view returns (uint256 rIn, uint256 rOut) {
        (uint112 r0, uint112 r1) = Pair(pair).getReserves();
        address t0 = Pair(pair).tokenA();
        if (input == t0) return (uint256(r0), uint256(r1));
        return (uint256(r1), uint256(r0));
    }

    function _toPairOrder(address tokenA, address t0, uint256 amountA, uint256 amountB)
        internal
        pure
        returns (uint256 a0, uint256 a1)
    {
        if (tokenA == t0) return (amountA, amountB);
        return (amountB, amountA);
    }

    function _fromPairOrder(address tokenA, address t0, uint256 amount0, uint256 amount1)
        internal
        pure
        returns (uint256 amountA, uint256 amountB)
    {
        if (tokenA == t0) return (amount0, amount1);
        return (amount1, amount0);
    }

    function _optimal(
        uint256 d0,
        uint256 d1,
        uint256 m0,
        uint256 m1,
        uint112 r0,
        uint112 r1
    )
        internal
        pure
        returns (uint256 a0, uint256 a1)
    {
        if (r0 == 0 && r1 == 0) return (d0, d1);

        uint256 optimal1 = (d0 * uint256(r1)) / uint256(r0);
        if (optimal1 <= d1) {
            require(optimal1 >= m1, "B_MIN");
            return (d0, optimal1);
        }

        uint256 optimal0 = (d1 * uint256(r0)) / uint256(r1);
        require(optimal0 >= m0, "A_MIN");
        return (optimal0, d1);
    }

    function _pull(address token, address from, uint256 amount) internal {
        if (amount == 0) return;
        IERC20(token).safeTransferFrom(from, address(this), amount);
    }

    function _approveIfNeeded(address token, address spender, uint256 amount) internal {
        if (amount == 0) return;
        uint256 current = IERC20(token).allowance(address(this), spender);
        if (current < amount) {
            IERC20(token).safeIncreaseAllowance(spender, amount - current);
        }
    }

    function _refundDust(address token, address to) internal {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) IERC20(token).safeTransfer(to, bal);
    }
}   