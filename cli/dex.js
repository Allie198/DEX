import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { RouterAbi, FactoryAbi, ERC20Abi } from './abi.js'
import { mustAddress, parseUnits, formatUnits } from './chain.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const TOKENS_PATH = path.resolve(__dirname, 'tokens.json')

function loadTokens() {
  try { return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8')) } catch { return [] }
}

async function getFactoryAddress(ctx) {
  if (ctx.cfg.factory && ctx.cfg.factory !== '0x') return mustAddress(ctx.cfg.factory, 'factory')
  const f = await ctx.publicClient.readContract({
    address: ctx.cfg.router,
    abi: RouterAbi,
    functionName: 'factory'
  })
  return mustAddress(f, 'factory')
}

async function pairExists(ctx, factory, a, b) {
  const pair = await ctx.publicClient.readContract({
    address: factory,
    abi: FactoryAbi,
    functionName: 'getPair',
    args: [a, b]
  })
  return pair && pair !== '0x0000000000000000000000000000000000000000'
}

function candidateMids(tokenIn, tokenOut) {
  const toks = loadTokens()
    .map(t => (t.address || '').trim())
    .filter(Boolean)
    .map(a => a.toLowerCase())

  const uniq = [...new Set(toks)]
  const mids = uniq
    .filter(a => a !== tokenIn.toLowerCase() && a !== tokenOut.toLowerCase())
    .map(a => mustAddress(a, 'token'))

  return mids
}

async function resolvePath(ctx, tokenIn, tokenOut, maxHops = 3) {
  tokenIn = mustAddress(tokenIn, 'tokenIn')
  tokenOut = mustAddress(tokenOut, 'tokenOut')

  const factory = await getFactoryAddress(ctx)

  if (await pairExists(ctx, factory, tokenIn, tokenOut)) return [tokenIn, tokenOut]

  const mids = candidateMids(tokenIn, tokenOut)

  if (maxHops >= 2) {
    for (const mid of mids) {
      if (await pairExists(ctx, factory, tokenIn, mid) && await pairExists(ctx, factory, mid, tokenOut)) {
        return [tokenIn, mid, tokenOut]
      }
    }
  }

  if (maxHops >= 3) {
    for (const mid1 of mids) {
      if (!(await pairExists(ctx, factory, tokenIn, mid1))) continue
      for (const mid2 of mids) {
        if (mid2.toLowerCase() === mid1.toLowerCase()) continue
        if (await pairExists(ctx, factory, mid1, mid2) && await pairExists(ctx, factory, mid2, tokenOut)) {
          return [tokenIn, mid1, mid2, tokenOut]
        }
      }
    }
  }

  throw new Error('No route found. Create liquidity for direct pair OR ensure intermediate tokens exist in tokens.json with liquidity.')
}

export async function approveIfNeeded(ctx, token, spender, needed) {
  token = mustAddress(token, 'token')
  spender = mustAddress(spender, 'spender')

  const allowance = await ctx.publicClient.readContract({
    address: token,
    abi: ERC20Abi,
    functionName: 'allowance',
    args: [ctx.account.address, spender]
  })
  if (allowance >= needed) return null


  return ctx.walletClient.writeContract({
    address: token,
    abi: ERC20Abi,
    functionName: 'approve',
    args: [spender, needed]
  })
}

async function decimalsOf(ctx, token) {
  return await ctx.publicClient.readContract({
    address: token,
    abi: ERC20Abi,
    functionName: 'decimals'
  })
}

export async function quote(ctx, tokenIn, tokenOut, amountHuman) {
  tokenIn = mustAddress(tokenIn, 'tokenIn')
  tokenOut = mustAddress(tokenOut, 'tokenOut')

  const path = await resolvePath(ctx, tokenIn, tokenOut, 3)

  const dIn = await decimalsOf(ctx, path[0])
  const dOut = await decimalsOf(ctx, path[path.length - 1])

  const amountIn = parseUnits(String(amountHuman), dIn)

  const amounts = await ctx.publicClient.readContract({
    address: ctx.cfg.router,
    abi: RouterAbi,
    functionName: 'getAmountsOut',
    args: [amountIn, path]
  })

  const amountOut = amounts[amounts.length - 1]
  return { path, amountIn, amountOut, outHuman: formatUnits(amountOut, dOut) }
}

export async function swap(ctx, tokenIn, tokenOut, amountHuman, minOutHuman, to) {
  tokenIn = mustAddress(tokenIn, 'tokenIn')
  tokenOut = mustAddress(tokenOut, 'tokenOut')
  to = mustAddress(to, 'to')

  const path = await resolvePath(ctx, tokenIn, tokenOut, 3)

  const dIn = await decimalsOf(ctx, path[0])
  const dOut = await decimalsOf(ctx, path[path.length - 1])

  const amountIn = parseUnits(String(amountHuman), dIn)
  const minOut = parseUnits(String(minOutHuman), dOut)

  await approveIfNeeded(ctx, path[0], ctx.cfg.router, amountIn)

  return ctx.walletClient.writeContract({
    address: ctx.cfg.router,
    abi: RouterAbi,
    functionName: 'swapExactTokensForTokens',
    args: [amountIn, minOut, path, to]
  })
}

export async function addLiquidity(ctx, tokenA, tokenB, amountAHuman, amountBHuman, minAHuman, minBHuman) {
  tokenA = mustAddress(tokenA, 'tokenA')
  tokenB = mustAddress(tokenB, 'tokenB')

  const dA = await decimalsOf(ctx, tokenA)
  const dB = await decimalsOf(ctx, tokenB)

  const amountA = parseUnits(String(amountAHuman), dA)
  const amountB = parseUnits(String(amountBHuman), dB)
  const minA = parseUnits(String(minAHuman), dA)
  const minB = parseUnits(String(minBHuman), dB)

  await approveIfNeeded(ctx, tokenA, ctx.cfg.router, amountA)
  await approveIfNeeded(ctx, tokenB, ctx.cfg.router, amountB)

  return ctx.walletClient.writeContract({
    address: ctx.cfg.router,
    abi: RouterAbi,
    functionName: 'addLiquidity',
    args: [tokenA, tokenB, amountA, amountB, minA, minB]
  })
}
