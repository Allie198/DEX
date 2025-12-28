import inquirer from 'inquirer'
import qrcode from 'qrcode-terminal'

import { loadConfig, saveConfig, makeClients, mustAddress } from './chain.js'
import { quote, swap, addLiquidity } from './dex.js'
import { deployToken, listTokens, getAllTokenBalances } from './token.js'
import { createOrder, readOrder, fillOrder, cancelOrder } from './limit.js'
import { deployFactory, deployRouter, deployLimit } from './deploy.js'

const GREEN = '\x1b[32m'
const RESET = '\x1b[0m'

const MONETA_BIG_MONEY_NW = String.raw`
${GREEN}
$$\      $$\  $$$$$$\  $$\   $$\ $$$$$$$$\ $$$$$$$$\  $$$$$$\  
$$$\    $$$ |$$  __$$\ $$$\  $$ |$$  _____|\__$$  __|$$  __$$\ 
$$$$\  $$$$ |$$ /  $$ |$$$$\ $$ |$$ |         $$ |   $$ /  $$ |
$$\$$\$$ $$ |$$ |  $$ |$$ $$\$$ |$$$$$\       $$ |   $$$$$$$$ |
$$ \$$$  $$ |$$ |  $$ |$$ \$$$$ |$$  __|      $$ |   $$  __$$ |
$$ |\$  /$$ |$$ |  $$ |$$ |\$$$ |$$ |         $$ |   $$ |  $$ |
$$ | \_/ $$ | $$$$$$  |$$ | \$$ |$$$$$$$$\    $$ |   $$ |  $$ |
\__|     \__| \______/ \__|  \__|\________|   \__|   \__|  \__|
${RESET}
`

function clear() {
  process.stdout.write('\x1b[2J\x1b[H')
}

function cleanup(code = 0) {
  process.stdout.write('\n')
  process.exit(code)
}

process.on('SIGINT', () => cleanup(0))
process.on('SIGTERM', () => cleanup(0))

function isZeroAddr(x) {
  return !x || x === '0x' || /^0x0{40}$/i.test(x)
}

function shortAddr(a) {
  if (!a || typeof a !== 'string') return 'unset'
  if (a === '0x') return 'unset'
  if (a.length < 12) return a
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function subtitleFromCfg(cfg) {
  return `RPC: ${cfg.rpc} | chainId: ${cfg.chainId} | router: ${shortAddr(cfg.router)} | factory: ${shortAddr(cfg.factory)} | limit: ${shortAddr(cfg.limit)}`
}

function banner(subtitle = '') {
  clear()
  process.stdout.write(MONETA_BIG_MONEY_NW)
  if (subtitle) process.stdout.write(subtitle + '\n\n')
}

async function pause(msg = 'Devam (Enter)') {
  await inquirer.prompt([{ type: 'input', name: 'x', message: msg }])
}

async function ensureCoreDeployed(cfg, clients) {
  const need =
    isZeroAddr(cfg.factory) ||
    isZeroAddr(cfg.router) ||
    isZeroAddr(cfg.limit)

  if (!need) return cfg

  banner(subtitleFromCfg(cfg))
  console.log('[core] Deploying missing contracts...\n')

  const ctx = { cfg, ...clients }

  const factory = isZeroAddr(cfg.factory) ? await deployFactory(ctx) : cfg.factory
  console.log('[core] Factory:', factory)

  const router = isZeroAddr(cfg.router) ? await deployRouter(ctx, factory) : cfg.router
  console.log('[core] Router :', router)

  const limit = isZeroAddr(cfg.limit) ? await deployLimit(ctx, router) : cfg.limit
  console.log('[core] Limit  :', limit)

  const next = { ...cfg, factory, router, limit }
  saveConfig(next)

  console.log('\n[core] Saved to config.json ✅\n')
  await pause()
  return next
}

async function editConfig(cfg) {
  banner(subtitleFromCfg(cfg))

  const ans = await inquirer.prompt([
    { type: 'input', name: 'rpc', message: 'RPC', default: cfg.rpc },
    { type: 'input', name: 'chainId', message: 'chainId', default: String(cfg.chainId) },
    { type: 'password', name: 'privateKey', message: 'privateKey', default: cfg.privateKey, mask: '*' },

    { type: 'input', name: 'factory', message: 'factory', default: cfg.factory },
    { type: 'input', name: 'router', message: 'router', default: cfg.router },
    { type: 'input', name: 'limit', message: 'limit', default: cfg.limit }
  ])

  const next = {
    ...cfg,
    rpc: ans.rpc,
    chainId: Number(ans.chainId),
    privateKey: ans.privateKey,
    factory: ans.factory === '0x' ? '0x' : mustAddress(ans.factory, 'factory'),
    router: ans.router === '0x' ? '0x' : mustAddress(ans.router, 'router'),
    limit: ans.limit === '0x' ? '0x' : mustAddress(ans.limit, 'limit')
  }

  saveConfig(next)
  return next
}

async function walletMenu(ctx) {
  for (;;) {
    banner(subtitleFromCfg(ctx.cfg))
    const { pick } = await inquirer.prompt([{
      type: 'list',
      name: 'pick',
      message: 'WALLET',
      choices: ['Show Address', 'Token Balance', 'My Tokens', new inquirer.Separator(), 'Back']
    }])

    if (pick === 'Back') return

    if (pick === 'Show Address') {
      banner(subtitleFromCfg(ctx.cfg))
      const addr = ctx.account.address
      console.log('Wallet Address:\n')
      console.log(addr, '\n')
      qrcode.generate(addr, { small: true })
      await pause()
      continue
    }

    if (pick === 'Token Balance') {
      banner(subtitleFromCfg(ctx.cfg))
      console.log('Wallet:', ctx.account.address, '\n')

      const balances = await getAllTokenBalances(ctx)
      if (!balances.length) {
        console.log('tokens.json boş. Önce token deploy et.')
        await pause()
        continue
      }

      for (const t of balances) {
        const label = `${t.symbol} ${t.name}`.trim()
        console.log(label.padEnd(20), ':', t.balance)
      }
      await pause()
      continue
    }

    if (pick === 'My Tokens') {
      banner(subtitleFromCfg(ctx.cfg))
      const toks = listTokens()
      if (!toks.length) {
        console.log('tokens.json boş. Önce Deploy Token yap.')
        await pause()
        continue
      }
      for (const t of toks) {
        console.log(`- ${t.symbol || '?'} ${t.name || ''} @ ${t.address}`)
      }
      await pause()
      continue
    }
  }
}

async function dexMenu(ctx) {
  for (;;) {
    banner(subtitleFromCfg(ctx.cfg))
    const { pick } = await inquirer.prompt([{
      type: 'list',
      name: 'pick',
      message: 'DEX',
      choices: ['Deploy Token', 'Add Liquidity', 'Quote', 'Swap', new inquirer.Separator(), 'Back']
    }])

    if (pick === 'Back') return

    if (pick === 'Deploy Token') {
      banner(subtitleFromCfg(ctx.cfg))
      const ans = await inquirer.prompt([
        { type: 'input', name: 'name', message: 'Token name', default: 'MyToken' },
        { type: 'input', name: 'symbol', message: 'Symbol', default: 'MTK' },
        { type: 'input', name: 'decimals', message: 'Decimals', default: '18' },
        { type: 'input', name: 'supply', message: 'Total supply (human)', default: '1000000' },
        { type: 'input', name: 'to', message: 'Mint to', default: ctx.account.address }
      ])

      const r = await deployToken(ctx, ans.name, ans.symbol, ans.supply, ans.decimals, ans.to)
      console.log('\nDeployed token:', r.address)
      console.log('Tx:', r.hash)
      console.log('\nNot: token tokens.json içine kaydedildi.')
      await pause()
      continue
    }

    if (pick === 'Add Liquidity') {
      banner(subtitleFromCfg(ctx.cfg))
      const ans = await inquirer.prompt([
        { type: 'input', name: 'tokenA', message: 'First  token address' },
        { type: 'input', name: 'tokenB', message: 'Second token address' },
        { type: 'input', name: 'amountA', message: 'amountA (human)', default: '1000' },
        { type: 'input', name: 'amountB', message: 'amountB (human)', default: '1000' },
        { type: 'input', name: 'minA', message: 'minA (human)', default: '0' },
        { type: 'input', name: 'minB', message: 'minB (human)', default: '0' }
      ])

      const hash = await addLiquidity(ctx, ans.tokenA, ans.tokenB, ans.amountA, ans.amountB, ans.minA, ans.minB)
      console.log('\nTx:', hash)
      await pause()
      continue
    }

    if (pick === 'Quote') {
      banner(subtitleFromCfg(ctx.cfg))
      const ans = await inquirer.prompt([
        { type: 'input', name: 'tokenIn', message: 'tokenIn' },
        { type: 'input', name: 'tokenOut', message: 'tokenOut' },
        { type: 'input', name: 'amount', message: 'amountIn (human)', default: '1' }
      ])

      const r = await quote(ctx, ans.tokenIn, ans.tokenOut, ans.amount)
      console.log('\nPath:', r.path.join(' -> '))
      console.log('Quoted out:', r.outHuman)
      await pause()
      continue
    }

    if (pick === 'Swap') {
      banner(subtitleFromCfg(ctx.cfg))
      const ans = await inquirer.prompt([
        { type: 'input', name: 'tokenIn', message: 'tokenIn' },
        { type: 'input', name: 'tokenOut', message: 'tokenOut' },
        { type: 'input', name: 'amount', message: 'amountIn', default: '1' },
        { type: 'input', name: 'minOut', message: 'minOut', default: '0' },
        { type: 'input', name: 'to', message: 'to', default: ctx.account.address }
      ])

      const q = await quote(ctx, ans.tokenIn, ans.tokenOut, ans.amount)
      console.log('\nAuto Path:', q.path.join(' -> '))
      console.log('Quoted out:', q.outHuman)

      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: 'Proceed?',
        default: true
      }])

      if (!confirm) {
        console.log('\nCancelled.')
        await pause()
        continue
      }

      const hash = await swap(ctx, ans.tokenIn, ans.tokenOut, ans.amount, ans.minOut, ans.to)
      console.log('\nTx:', hash)
      await pause()
      continue
    }
  }
}

async function limitMenu(ctx) {
  for (;;) {
    banner(subtitleFromCfg(ctx.cfg))
    const { pick } = await inquirer.prompt([{
      type: 'list',
      name: 'pick',
      message: 'LIMIT',
      choices: ['Create', 'Read', 'Fill', 'Cancel', new inquirer.Separator(), 'Back']
    }])

    if (pick === 'Back') return

    if (pick === 'Create') {
      banner(subtitleFromCfg(ctx.cfg))
      const ans = await inquirer.prompt([
        { type: 'input', name: 'tokenIn', message: 'tokenIn' },
        { type: 'input', name: 'tokenOut', message: 'tokenOut' },
        { type: 'input', name: 'amount', message: 'amountIn (human)', default: '1' },
        { type: 'input', name: 'minOut', message: 'minOut (human)', default: '0' },
        { type: 'input', name: 'expireAt', message: 'expireAt unix (0=none)', default: '0' }
      ])

      const hash = await createOrder(ctx, ans.tokenIn, ans.tokenOut, ans.amount, ans.minOut, Number(ans.expireAt))
      console.log('\nTx:', hash)
      await pause()
      continue
    }

    if (pick === 'Read') {
      banner(subtitleFromCfg(ctx.cfg))
      const { id } = await inquirer.prompt([{ type: 'input', name: 'id', message: 'order id' }])
      const o = await readOrder(ctx, id)
      console.log('\nOrder:', o)
      await pause()
      continue
    }

    if (pick === 'Fill') {
      banner(subtitleFromCfg(ctx.cfg))
      const { id } = await inquirer.prompt([{ type: 'input', name: 'id', message: 'order id' }])
      const hash = await fillOrder(ctx, id)
      console.log('\nTx:', hash)
      await pause()
      continue
    }

    if (pick === 'Cancel') {
      banner(subtitleFromCfg(ctx.cfg))
      const { id } = await inquirer.prompt([{ type: 'input', name: 'id', message: 'order id' }])
      const hash = await cancelOrder(ctx, id)
      console.log('\nTx:', hash)
      await pause()
      continue
    }
  }
}

async function main() {
  let cfg = loadConfig()
  const clients0 = makeClients(cfg)
  cfg = await ensureCoreDeployed(cfg, clients0)

  for (;;) {
    banner(subtitleFromCfg(cfg))
    const { pick } = await inquirer.prompt([{
      type: 'list',
      name: 'pick',
      message: 'Welcome to MONETA SWAP\n',
      choices: ['Wallet', 'DEX', 'Limit', 'Config', new inquirer.Separator(), 'Exit']
    }])

    if (pick === 'Exit') cleanup(0)

    if (pick === 'Config') {
      cfg = await editConfig(cfg)
      continue
    }

    const ctx = { cfg, ...makeClients(cfg) }

    if (pick === 'Wallet') await walletMenu(ctx)
    if (pick === 'DEX') await dexMenu(ctx)
    if (pick === 'Limit') await limitMenu(ctx)
  }
}

main().catch((e) => {
  console.error(e)
  cleanup(1)
})
