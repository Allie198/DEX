import { LimitOrderAbi, ERC20Abi } from './abi.js'
import { mustAddress, parseUnits } from './chain.js'
import { approveIfNeeded } from './dex.js'

export async function createOrder(ctx, tokenIn, tokenOut, amountHuman, minOutHuman, expireAtUnix) {
  tokenIn = mustAddress(tokenIn, 'tokenIn')
  tokenOut = mustAddress(tokenOut, 'tokenOut')

  const dIn = await ctx.publicClient.readContract({ address: tokenIn, abi: ERC20Abi, functionName: 'decimals' })
  const dOut = await ctx.publicClient.readContract({ address: tokenOut, abi: ERC20Abi, functionName: 'decimals' })

  const amountIn = parseUnits(amountHuman, dIn)
  const minOut = parseUnits(minOutHuman, dOut)

  await approveIfNeeded(ctx, tokenIn, ctx.cfg.limit, amountIn)

  return ctx.walletClient.writeContract({
    address: ctx.cfg.limit,
    abi: LimitOrderAbi,
    functionName: 'createOrder',
    args: [tokenIn, tokenOut, amountIn, minOut, BigInt(expireAtUnix || 0)]
  })
}

export async function readOrder(ctx, id) {
  return ctx.publicClient.readContract({
    address: ctx.cfg.limit,
    abi: LimitOrderAbi,
    functionName: 'orders',
    args: [BigInt(id)]
  })
}

export async function fillOrder(ctx, id) {
  return ctx.walletClient.writeContract({
    address: ctx.cfg.limit,
    abi: LimitOrderAbi,
    functionName: 'fillOrder',
    args: [BigInt(id)]
  })
}

export async function cancelOrder(ctx, id) {
  return ctx.walletClient.writeContract({
    address: ctx.cfg.limit,
    abi: LimitOrderAbi,
    functionName: 'cancelOrder',
    args: [BigInt(id)]
  })
}
