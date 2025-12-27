// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./Factory.sol";
import "./Pair.sol";

contract Router {
    using SafeERC20 for IERC20;

    Factory public immutable factory;

    constructor(address _factory) {
        require(_factory != address(0), "ROUTER: factory address is zero");
        factory = Factory(_factory);
    }

    struct AddLiquidityVars {
        address pair;
        address pairToken0;

        uint112 reserve0;
        uint112 reserve1;

        uint256 desired0;
        uint256 desired1;

        uint256 min0;
        uint256 min1;

        uint256 amount0;
        uint256 amount1;

        uint256 amountA;
        uint256 amountB;

        uint256 liquidity;
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
        returns (address pair, uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        require(tokenA != address(0), "ROUTER: tokenA is zero address");
        require(tokenB != address(0), "ROUTER: tokenB is zero address");
        require(tokenA != tokenB, "ROUTER: tokenA and tokenB must differ");
        require(desiredA > 0, "ROUTER: desiredA must be > 0");
        require(desiredB > 0, "ROUTER: desiredB must be > 0");

        AddLiquidityVars memory v;

        v.pair = _getOrCreatePair(tokenA, tokenB);
        v.pairToken0 = Pair(v.pair).tokenA();
        (v.reserve0, v.reserve1) = Pair(v.pair).getReserves();

        (v.desired0, v.desired1) = _toPairOrder(tokenA, v.pairToken0, desiredA, desiredB);
        (v.min0, v.min1) = _toPairOrder(tokenA, v.pairToken0, minA, minB);

        (v.amount0, v.amount1) = _optimalAmounts(
            v.desired0,
            v.desired1,
            v.min0,
            v.min1,
            v.reserve0,
            v.reserve1
        );

        (v.amountA, v.amountB) = _fromPairOrder(tokenA, v.pairToken0, v.amount0, v.amount1);

        _pull(tokenA, msg.sender, v.amountA);
        _pull(tokenB, msg.sender, v.amountB);

        _approveIfNeeded(tokenA, v.pair, v.amountA);
        _approveIfNeeded(tokenB, v.pair, v.amountB);

        v.liquidity = Pair(v.pair).addLiquidity(v.amount0, v.amount1, msg.sender);

        _refundDust(tokenA, msg.sender);
        _refundDust(tokenB, msg.sender);

        return (v.pair, v.amountA, v.amountB, v.liquidity);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 lpAmount,
        uint256 minA,
        uint256 minB,
        address to
    )
        external
        returns (uint256 amountA, uint256 amountB)
    {
        require(to != address(0), "ROUTER: recipient (to) is zero address");
        require(lpAmount > 0, "ROUTER: LP amount must be > 0");

        address pair = factory.getPair(tokenA, tokenB);
        require(pair != address(0), "ROUTER: pair does not exist");

        IERC20(pair).safeTransferFrom(msg.sender, address(this), lpAmount);
        (uint256 amount0, uint256 amount1) = Pair(pair).removeLiquidity(lpAmount);

        address pairToken0 = Pair(pair).tokenA();
        (amountA, amountB) = _fromPairOrder(tokenA, pairToken0, amount0, amount1);

        require(amountA >= minA, "ROUTER: amountA below minA");
        require(amountB >= minB, "ROUTER: amountB below minB");

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
        require(path.length >= 2, "ROUTER: path length must be >= 2");
        require(to != address(0), "ROUTER: recipient (to) is zero address");
        require(amountIn > 0, "ROUTER: amountIn must be > 0");

        amounts = getAmountsOut(amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "ROUTER: slippage (output < amountOutMin)");

        _pull(path[0], msg.sender, amounts[0]);

        for (uint256 i = 0; i < path.length - 1; i++) {
            address tokenIn = path[i];
            address tokenOut = path[i + 1];

            address pair = factory.getPair(tokenIn, tokenOut);
            require(pair != address(0), "ROUTER: missing pair for hop");

            _approveIfNeeded(tokenIn, pair, amounts[i]);

            address hopRecipient = (i == path.length - 2) ? to : address(this);
            Pair(pair).swap(tokenIn, amounts[i], 0, hopRecipient);
        }

        return amounts;
    }

    function getAmountsOut(uint256 amountIn, address[] memory path)
        public
        view
        returns (uint256[] memory amounts)
    {
        require(path.length >= 2, "ROUTER: path length must be >= 2");

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;

        for (uint256 i = 0; i < path.length - 1; i++) {
            address pair = factory.getPair(path[i], path[i + 1]);
            require(pair != address(0), "ROUTER: missing pair for quote");
            amounts[i + 1] = Pair(pair).quoteOut(path[i], amounts[i]);
        }
    }

    function _getOrCreatePair(address tokenA, address tokenB) internal returns (address pair) {
        pair = factory.getPair(tokenA, tokenB);
        if (pair == address(0)) pair = factory.createPair(tokenA, tokenB);
    }

    function _reservesFor(address pair, address inputToken) internal view returns (uint256 reserveIn, uint256 reserveOut) {
        (uint112 reserve0, uint112 reserve1) = Pair(pair).getReserves();
        address pairToken0 = Pair(pair).tokenA();
        if (inputToken == pairToken0) return (uint256(reserve0), uint256(reserve1));
        return (uint256(reserve1), uint256(reserve0));
    }

    function _toPairOrder(
        address tokenA,
        address pairToken0,
        uint256 amountA,
        uint256 amountB
    )
        internal
        pure
        returns (uint256 amount0, uint256 amount1)
    {
        if (tokenA == pairToken0) return (amountA, amountB);
        return (amountB, amountA);
    }

    function _fromPairOrder(
        address tokenA,
        address pairToken0,
        uint256 amount0,
        uint256 amount1
    )
        internal
        pure
        returns (uint256 amountA, uint256 amountB)
    {
        if (tokenA == pairToken0) return (amount0, amount1);
        return (amount1, amount0);
    }

    function _optimalAmounts(
        uint256 desired0,
        uint256 desired1,
        uint256 min0,
        uint256 min1,
        uint112 reserve0,
        uint112 reserve1
    )
        internal
        pure
        returns (uint256 amount0, uint256 amount1)
    {
        if (reserve0 == 0 && reserve1 == 0) return (desired0, desired1);

        uint256 optimal1 = (desired0 * uint256(reserve1)) / uint256(reserve0);
        if (optimal1 <= desired1) {
            require(optimal1 >= min1, "ROUTER: tokenB amount below minB");
            return (desired0, optimal1);
        }

        uint256 optimal0 = (desired1 * uint256(reserve0)) / uint256(reserve1);
        require(optimal0 >= min0, "ROUTER: tokenA amount below minA");
        return (optimal0, desired1);
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
