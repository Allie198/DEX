import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ERCTemplateArtifact, ERC20Abi } from './abi.js'
import { mustAddress, parseUnits, formatUnits } from './chain.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const TOKENS_PATH = path.resolve(__dirname, 'tokens.json')

function loadTokens() {
  try { return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8')) } catch { return [] }
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2))
}

function upsertToken(entry) {
  const tokens = loadTokens()
  const addr = entry.address.toLowerCase()
  const i = tokens.findIndex(t => (t.address || '').toLowerCase() === addr)
  if (i >= 0) tokens[i] = { ...tokens[i], ...entry }
  else tokens.push(entry)
  saveTokens(tokens)
}

export function listTokens() {
  return loadTokens()
}

export async function deployToken(ctx, name, symbol, supplyHuman, decimals, to) {
  to = mustAddress(to, 'to')
  const dec = Number(decimals)
  if (!Number.isFinite(dec) || dec < 0 || dec > 255) throw new Error('decimals invalid')

  const supply = parseUnits(String(supplyHuman), dec)

  const hash = await ctx.walletClient.deployContract({
    abi: ERCTemplateArtifact.abi,
    bytecode: ERCTemplateArtifact.bytecode,
    args: [name, symbol, supply, to]
  })

  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash })
  if (!receipt.contractAddress) throw new Error('deploy failed: no contractAddress')

  upsertToken({ address: receipt.contractAddress, name, symbol, decimals: dec })
  return { hash, address: receipt.contractAddress }
}

export async function getTokenBalance(ctx, tokenAddress) {
  tokenAddress = mustAddress(tokenAddress, 'token')

  const decimals = await ctx.publicClient.readContract({
    address: tokenAddress,
    abi: ERC20Abi,
    functionName: 'decimals'
  })

  const balance = await ctx.publicClient.readContract({
    address: tokenAddress,
    abi: ERC20Abi,
    functionName: 'balanceOf',
    args: [ctx.account.address]
  })

  return { raw: balance, human: formatUnits(balance, decimals), decimals }
}

export async function tokenMeta(ctx, tokenAddress) {
  tokenAddress = mustAddress(tokenAddress, 'token')

  const [name, symbol, decimals] = await Promise.all([
    ctx.publicClient.readContract({ address: tokenAddress, abi: ERC20Abi, functionName: 'name' }),
    ctx.publicClient.readContract({ address: tokenAddress, abi: ERC20Abi, functionName: 'symbol' }),
    ctx.publicClient.readContract({ address: tokenAddress, abi: ERC20Abi, functionName: 'decimals' })
  ])

  return { name, symbol, decimals }
}

export async function getAllTokenBalances(ctx) {
  const tokens = loadTokens()
  const results = []

  for (const t of tokens) {
    try {
      const address = mustAddress(t.address, 'token')
      const decimals = await ctx.publicClient.readContract({
        address,
        abi: ERC20Abi,
        functionName: 'decimals'
      })

      const balance = await ctx.publicClient.readContract({
        address,
        abi: ERC20Abi,
        functionName: 'balanceOf',
        args: [ctx.account.address]
      })

      results.push({
        address,
        symbol: t.symbol || '?',
        name: t.name || '',
        balance: formatUnits(balance, decimals)
      })
    } catch (e) {
      results.push({
        address: t.address,
        symbol: t.symbol || '?',
        name: t.name || '',
        balance: 'ERR'
      })
    }
  }

  return results
}
