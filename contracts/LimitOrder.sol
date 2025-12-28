// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IRouter {
    function getAmountsOut(uint256 amountIn, address[] memory path) external view returns (uint256[] memory amounts);

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to
    ) external returns (uint256[] memory amounts);
}

contract LimitOrder is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        OPEN,
        FILLED,
        CANCELLED,
        EXPIRED
    }

    struct Order {
        address maker;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        uint64 createdAt;
        uint64 expireAt;
        Status status;
    }

    IRouter public immutable router;
    uint256 public nextOrderId;

    mapping(uint256 => Order) public orders;

    event OrderCreated(
        uint256 indexed id,
        address indexed maker,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint64 expireAt
    );

    event OrderCancelled(uint256 indexed id);
    event OrderFilled(uint256 indexed id, address indexed filler, uint256 amountOut);
    event OrderExpired(uint256 indexed id);

    constructor(address router_) {
        require(router_ != address(0), "LIMIT: router address is zero");
        router = IRouter(router_);
    }

    function createOrder(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint64 expireAt
    ) external nonReentrant returns (uint256 id) {
        require(tokenIn != address(0), "LIMIT: tokenIn is zero address");
        require(tokenOut != address(0), "LIMIT: tokenOut is zero address");
        require(tokenIn != tokenOut, "LIMIT: tokenIn and tokenOut must differ");
        require(amountIn > 0, "LIMIT: amountIn must be > 0");
        require(minAmountOut > 0, "LIMIT: minAmountOut must be > 0");
        
        if (expireAt != 0) require(expireAt > uint64(block.timestamp), "LIMIT: expireAt must be in future");

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        id = ++nextOrderId;
        orders[id] = Order({
            maker: msg.sender,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            createdAt: uint64(block.timestamp),
            expireAt: expireAt,
            status: Status.OPEN
        });

        emit OrderCreated(id, msg.sender, tokenIn, tokenOut, amountIn, minAmountOut, expireAt);
    }

    function cancelOrder(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        require(o.maker != address(0), "LIMIT: order does not exist");
        require(o.maker == msg.sender, "LIMIT: only maker can cancel");
        require(o.status == Status.OPEN, "LIMIT: order is not open");

        o.status = Status.CANCELLED;
        IERC20(o.tokenIn).safeTransfer(o.maker, o.amountIn);

        emit OrderCancelled(id);
    }

    function fillOrder(uint256 id) external nonReentrant returns (uint256 amountOut) {
        Order storage o = orders[id];
        require(o.maker != address(0), "LIMIT: order does not exist");
        require(o.status == Status.OPEN, "LIMIT: order is not open");

        if (o.expireAt != 0 && block.timestamp > o.expireAt) {
            o.status = Status.EXPIRED;
            IERC20(o.tokenIn).safeTransfer(o.maker, o.amountIn);
            emit OrderExpired(id);
            return 0;
        }

        address[] memory path = new address[](2);
        path[0] = o.tokenIn;
        path[1] = o.tokenOut;

        uint256[] memory quoted = router.getAmountsOut(o.amountIn, path);
        require(quoted[1] >= o.minAmountOut, "LIMIT: price not met (minOut not reached)");

        IERC20(o.tokenIn).forceApprove(address(router), o.amountIn);

        uint256[] memory amounts = router.swapExactTokensForTokens(o.amountIn, o.minAmountOut, path, o.maker);

        amountOut = amounts[amounts.length - 1];
        o.status = Status.FILLED;

        emit OrderFilled(id, msg.sender, amountOut);
    }

    function isFillable(uint256 id) external view returns (bool ok, uint256 quotedOut) {
        Order storage o = orders[id];
        if (o.maker == address(0)) return (false, 0);
        if (o.status != Status.OPEN) return (false, 0);
        if (o.expireAt != 0 && block.timestamp > o.expireAt) return (false, 0);

        address[] memory path = new address[](2);
        path[0] = o.tokenIn;
        path[1] = o.tokenOut;

        uint256[] memory amounts = router.getAmountsOut(o.amountIn, path);
        quotedOut = amounts[1];
        ok = (quotedOut >= o.minAmountOut);
    }
}
