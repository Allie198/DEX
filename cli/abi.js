import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function loadArtifact(contractName) {
  const p = path.resolve(
    __dirname,
    '..',
    'artifacts',
    'contracts',
    `${contractName}.sol`,
    `${contractName}.json`
  )
  const raw = fs.readFileSync(p, 'utf8')
  const j = JSON.parse(raw)
  const bytecode =
    typeof j.bytecode === 'string'
      ? j.bytecode
      : (j.bytecode && j.bytecode.object) ? j.bytecode.object : '0x'
  return { abi: j.abi, bytecode }
}

export const ERCTemplateArtifact = loadArtifact('ERCTemplate')
export const FactoryArtifact = loadArtifact('Factory')
export const PairArtifact = loadArtifact('Pair')
export const RouterArtifact = loadArtifact('Router')
export const LimitOrderArtifact = loadArtifact('LimitOrder')

export const ERCTemplateAbi = ERCTemplateArtifact.abi
export const FactoryAbi = FactoryArtifact.abi
export const PairAbi = PairArtifact.abi
export const RouterAbi = RouterArtifact.abi
export const LimitOrderAbi = LimitOrderArtifact.abi

export const ERC20Abi = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address', name: 'a' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ type: 'address', name: 'o' }, { type: 'address', name: 's' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ type: 'address', name: 's' }, { type: 'uint256', name: 'a' }], outputs: [{ type: 'bool' }] }
]
