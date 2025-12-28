import { FactoryArtifact, RouterArtifact, LimitOrderArtifact } from './abi.js'
import { mustAddress } from './chain.js'

export async function deployFactory(ctx) {
  const hash = await ctx.walletClient.deployContract({
    abi: FactoryArtifact.abi,
    bytecode: FactoryArtifact.bytecode,
    args: []
  })
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash })
  if (!receipt.contractAddress) throw new Error('Factory deploy failed')
  return receipt.contractAddress
}

export async function deployRouter(ctx, factoryAddress) {
  factoryAddress = mustAddress(factoryAddress, 'factory')
  const hash = await ctx.walletClient.deployContract({
    abi: RouterArtifact.abi,
    bytecode: RouterArtifact.bytecode,
    args: [factoryAddress]
  })
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash })
  if (!receipt.contractAddress) throw new Error('Router deploy failed')
  return receipt.contractAddress
}

export async function deployLimit(ctx, routerAddress) {
  routerAddress = mustAddress(routerAddress, 'router')
  const hash = await ctx.walletClient.deployContract({
    abi: LimitOrderArtifact.abi,
    bytecode: LimitOrderArtifact.bytecode,
    args: [routerAddress]
  })
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash })
  if (!receipt.contractAddress) throw new Error('LimitOrder deploy failed')
  return receipt.contractAddress
}
 