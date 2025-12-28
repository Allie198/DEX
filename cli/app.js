import readline from 'node:readline'

import { loadConfig, saveConfig, makeClients, mustAddress } from './chain.js'
import { quote, swap, addLiquidity } from './dex.js'
import { deployToken, getTokenBalance, listTokens, tokenMeta, getAllTokenBalances} from './token.js'
import { createOrder, readOrder, fillOrder, cancelOrder } from './limit.js'
import qrcode from 'qrcode-terminal'


const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

const GREEN = '\x1b[32m'
const RESET = '\x1b[0m'

const MONETA_BIG_MONEY_NW = String.raw `
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


function cleanup(code = 0) {
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false) } catch {}
  try { rl.close() } catch {}
  process.stdout.write('\n')
  process.exit(code)
}

process.on('SIGINT', () => cleanup(0))
process.on('SIGTERM', () => cleanup(0))

function clear() {
  process.stdout.write('\x1b[2J\x1b[H')
}

function hideCursor() {
  process.stdout.write('\x1b[?25l')
}

function showCursor() {
  process.stdout.write('\x1b[?25h')
}

function render(title, items, idx, subtitle = '') {
  clear()
  process.stdout.write(MONETA_BIG_MONEY_NW)
  process.stdout.write('\n\n')
  if (subtitle) process.stdout.write(`${subtitle}\n`)
  process.stdout.write('\n')
  for (let i = 0; i < items.length; i++) {
    const prefix = i === idx ? '➤ ' : '  '
    const line = `${prefix}${items[i]}`
    if (i === idx) process.stdout.write(`\x1b[7m${line}\x1b[0m\n`)
    else process.stdout.write(`${line}\n`)
  }
  process.stdout.write('\n(↑ ↓ seç, Enter onayla, Esc geri, Ctrl+C çık)\n')
}

function menu(title, items, subtitle = '') {
  return new Promise((resolve) => {
    let idx = 0

    readline.emitKeypressEvents(process.stdin)
    if (process.stdin.isTTY) process.stdin.setRawMode(true)

    hideCursor()
    render(title, items, idx, subtitle)

    function onKey(_, key) {
      if (!key) return

      if (key.ctrl && key.name === 'c') {
        process.stdin.off('keypress', onKey)
        showCursor()
        cleanup(0)
        return
      }

      if (key.name === 'up') {
        idx = (idx - 1 + items.length) % items.length
        render(title, items, idx, subtitle)
        return
      }

      if (key.name === 'down') {
        idx = (idx + 1) % items.length
        render(title, items, idx, subtitle)
        return
      }

      if (key.name === 'return') {
        process.stdin.off('keypress', onKey)
        showCursor()
        resolve(items[idx])
        return
      }

      if (key.name === 'escape') {
        process.stdin.off('keypress', onKey)
        showCursor()
        resolve('__BACK__')
        return
      }
    }

    process.stdin.on('keypress', onKey)
  })
}

function ask(q, def = '') {
  return new Promise((resolve) => {
    const p = def ? `${q} (${def}): ` : `${q}: `
    rl.question(p, (ans) => {
      const v = (ans ?? '').trim()
      resolve(v.length ? v : def)
    })
  })
}

async function pause(msg = 'Devam (Enter)') {
  await ask(`\n${msg}`, '')
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

async function editConfig(cfg) {
  clear()
  process.stdout.write(MONETA_BIG_MONEY_NW)

  const rpc = await ask('RPC', cfg.rpc)
  const chainIdStr = await ask('chainId', String(cfg.chainId))
  const privateKey = await ask('privateKey', cfg.privateKey)

  const factory = await ask('factory', cfg.factory)
  const router = await ask('router', cfg.router)
  const limit = await ask('limit', cfg.limit)

  const next = {
    ...cfg,
    rpc,
    chainId: Number(chainIdStr),
    privateKey,
    factory: factory === '0x' ? '0x' : mustAddress(factory, 'factory'),
    router: router === '0x' ? '0x' : mustAddress(router, 'router'),
    limit: limit === '0x' ? '0x' : mustAddress(limit, 'limit')
  }

  saveConfig(next)
  return next
}

async function walletMenu(ctx) {
  for (;;) {
    const pick = await menu('WALLET', ['Show Address', 'Token Balance', 'My Tokens', 'Back'], subtitleFromCfg(ctx.cfg))
    if (pick === 'Back' || pick === '__BACK__') return

    if (pick === 'Show Address') {
          clear()
          process.stdout.write(MONETA_BIG_MONEY_NW)

          const addr = ctx.account.address

          console.log('Wallet Address:\n')
          console.log(addr, '\n')

          qrcode.generate(addr, { small: true })

          await pause()
    }

    if (pick === 'Token Balance') {
        clear()
        process.stdout.write(MONETA_BIG_MONEY_NW)

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
  }
    if (pick === 'My Tokens') {
      clear()
      process.stdout.write(MONETA_BIG_MONEY_NW)
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
    }
  }
}

async function dexMenu(ctx) {
  for (;;) {
    const pick = await menu(
      'DEX',
      ['Deploy Token', 'Add Liquidity', 'Quote', 'Swap', 'Back'],
      subtitleFromCfg(ctx.cfg)
    )
    if (pick === 'Back' || pick === '__BACK__') return

    if (pick === 'Deploy Token') {
      clear()
      process.stdout.write(MONETA_BIG_MONEY_NW)

      const name = await ask('Token name', 'MyToken')
      const symbol = await ask('Symbol', 'MTK')
      const decimals = await ask('Decimals', '18')
      const supply = await ask('Total supply (human)', '1000000')
      const to = await ask('Mint to', ctx.account.address)

      const r = await deployToken(ctx, name, symbol, supply, decimals, to)
      console.log('\nDeployed token:', r.address)
      console.log('Tx:', r.hash)
      console.log('\nNot: token tokens.json içine kaydedildi.')
      await pause()
    }

    if (pick === 'Add Liquidity') {
      clear()
      process.stdout.write(MONETA_BIG_MONEY_NW)

      const tokenA = await ask('tokenA address')
      const tokenB = await ask('tokenB address')
      const amountA = await ask('amountA (human)', '1000')
      const amountB = await ask('amountB (human)', '1000')
      const minA = await ask('minA (human)', '0')
      const minB = await ask('minB (human)', '0')

      const hash = await addLiquidity(ctx, tokenA, tokenB, amountA, amountB, minA, minB)
      console.log('\nTx:', hash)
      await pause()
    }

    if (pick === 'Quote') {
      clear()
      process.stdout.write(MONETA_BIG_MONEY_NW)

      const tokenIn = await ask('tokenIn')
      const tokenOut = await ask('tokenOut')
      const amount = await ask('amountIn (human)', '1')

      const r = await quote(ctx, tokenIn, tokenOut, amount)
      console.log('\nPath:', r.path.join(' -> '))
      console.log('Quoted out:', r.outHuman)
      await pause()
    }

    if (pick === 'Swap') {
      clear()
      process.stdout.write(MONETA_BIG_MONEY_NW)

      const tokenIn = await ask('tokenIn')
      const tokenOut = await ask('tokenOut')
      const amount = await ask('amountIn (human)', '1')
      const minOut = await ask('minOut (human)', '0')
      const to = await ask('to', ctx.account.address)

      const q = await quote(ctx, tokenIn, tokenOut, amount)
      console.log('\nAuto Path:', q.path.join(' -> '))
      console.log('Quoted out:', q.outHuman)

      const confirm = await ask('Proceed? (y/n)', 'y')
      if (confirm.toLowerCase() !== 'y') {
        console.log('\nCancelled.')
        await pause()
        continue
      }

      const hash = await swap(ctx, tokenIn, tokenOut, amount, minOut, to)
      console.log('\nTx:', hash)
      await pause()
    }
  }
}

async function limitMenu(ctx) {
  for (;;) {
    const pick = await menu('LIMIT', ['Create', 'Read', 'Fill', 'Cancel', 'Back'], subtitleFromCfg(ctx.cfg))
    if (pick === 'Back' || pick === '__BACK__') return

    if (pick === 'Create') {
      clear()
      process.stdout.write(MONETA_BIG_MONEY_NW)

      const tokenIn = await ask('tokenIn')
      const tokenOut = await ask('tokenOut')
      const amount = await ask('amountIn (human)', '1')
      const minOut = await ask('minOut (human)', '0')
      const expireAt = await ask('expireAt unix (0=none)', '0')

      const hash = await createOrder(ctx, tokenIn, tokenOut, amount, minOut, Number(expireAt))
      console.log('\nTx:', hash)
      await pause()
    }

    if (pick === 'Read') {
      clear()
      process.stdout.write(MONETA_BIG_MONEY_NW)

      const id = await ask('order id')
      const o = await readOrder(ctx, id)
      console.log('\nOrder:', o)
      await pause()
    }

    if (pick === 'Fill') {
      clear()
      process.stdout.write(MONETA_BIG_MONEY_NW)

      const id = await ask('order id')
      const hash = await fillOrder(ctx, id)
      console.log('\nTx:', hash)
      await pause()
    }

    if (pick === 'Cancel') {
      clear()
      process.stdout.write(MONETA_BIG_MONEY_NW)

      const id = await ask('order id')
      const hash = await cancelOrder(ctx, id)
      console.log('\nTx:', hash)
      await pause()
    }
  }
}

async function main() {
  let cfg = loadConfig()

  for (;;) {
    const pick = await menu('MAIN', ['Wallet', 'DEX', 'Limit', 'Config', 'Exit'], subtitleFromCfg(cfg))

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
