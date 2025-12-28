import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function main() {
  const [deployer] = await ethers.getSigners()

  const Factory = await ethers.getContractFactory('Factory')
  const factory = await Factory.deploy()
  await factory.waitForDeployment()

  const Router = await ethers.getContractFactory('Router')
  const router = await Router.deploy(await factory.getAddress())
  await router.waitForDeployment()

  const Limit = await ethers.getContractFactory('LimitOrder')
  const limit = await Limit.deploy(await router.getAddress())
  await limit.waitForDeployment()

  const net = await ethers.provider.getNetwork()

  const cliCfgPath = path.resolve(__dirname, '..', 'cli', 'config.json')
  const old = JSON.parse(fs.readFileSync(cliCfgPath, 'utf8'))

  const next = {
    ...old,
    chainId: Number(net.chainId),
    factory: await factory.getAddress(),
    router: await router.getAddress(),
    limit: await limit.getAddress()
  }

  fs.writeFileSync(cliCfgPath, JSON.stringify(next, null, 2))

  console.log('Deployer:', deployer.address)
  console.log('Factory:', next.factory)
  console.log('Router :', next.router)
  console.log('Limit  :', next.limit)
  console.log('Wrote  : cli/config.json')
}

main().catch((e) => { console.error(e); process.exit(1) })
