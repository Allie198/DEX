import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, http, isAddress, parseUnits, formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const CFG_PATH = path.resolve(__dirname, 'config.json')

export function loadConfig() {
  return JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'))
}

export function saveConfig(cfg) {
  fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2))
}

export function makeClients(cfg) {
  if (!cfg.rpc) throw new Error('config.rpc missing')
  if (!cfg.chainId) throw new Error('config.chainId missing')
  if (!cfg.privateKey || !cfg.privateKey.startsWith('0x') || cfg.privateKey.length < 10) throw new Error('config.privateKey missing')

  const account = privateKeyToAccount(cfg.privateKey)

  const chain = {
    id: Number(cfg.chainId),
    name: 'custom',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpc] } }
  }

  const publicClient = createPublicClient({ chain, transport: http(cfg.rpc) })
  const walletClient = createWalletClient({ chain, account, transport: http(cfg.rpc) })

  return { account, publicClient, walletClient }
}

export function mustAddress(x, label = 'address') {
  if (!isAddress(x)) throw new Error(`${label} invalid`)
  return x
}

export { parseUnits, formatUnits }
