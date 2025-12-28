import fs from "node:fs";
import assert from "node:assert/strict";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  getContract,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = "http://127.0.0.1:8545";

const CHAIN = {
  id: 31337,
  name: "Hardhat",
  network: "hardhat",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] }, public: { http: [RPC] } },
};

const DEPLOYER_PK =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TRADER_PK =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const log = (...a) => console.log(...a);

function normalizeBytecode(bc) {
  if (!bc) throw new Error("Bytecode missing");
  if (typeof bc === "string") return bc.startsWith("0x") ? bc : `0x${bc}`;
  if (typeof bc === "object" && typeof bc.object === "string")
    return bc.object.startsWith("0x") ? bc.object : `0x${bc.object}`;
  throw new Error("Unknown bytecode format");
}

function artifact(name) {
  const p = `./artifacts/contracts/${name}.sol/${name}.json`;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  return { abi: j.abi, bytecode: normalizeBytecode(j.bytecode) };
}

async function deploy(w, p, a, args = []) {
  const hash = await w.deployContract({ abi: a.abi, bytecode: a.bytecode, args, account: w.account });
  const rc = await p.waitForTransactionReceipt({ hash });
  assert(rc.contractAddress, "deploy failed");
  return rc.contractAddress;
}

async function main() {
  const deployer = privateKeyToAccount(DEPLOYER_PK);
  const trader = privateKeyToAccount(TRADER_PK);

  const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC) });
  const wD = createWalletClient({ chain: CHAIN, transport: http(RPC), account: deployer });
  const wT = createWalletClient({ chain: CHAIN, transport: http(RPC), account: trader });

  const ERCTemplate = artifact("ERCTemplate");
  const Factory = artifact("Factory");
  const Router = artifact("Router");
  const Pair = artifact("Pair");
  const LOM = artifact("LimitOrder"); 

  log("Deploy...");
  const tokenA = await deploy(wD, publicClient, ERCTemplate, ["TokenA", "TKA", parseEther("1000000"), deployer.address]);
  const tokenB = await deploy(wD, publicClient, ERCTemplate, ["TokenB", "TKB", parseEther("1000000"), deployer.address]);
  const factory = await deploy(wD, publicClient, Factory);
  const router = await deploy(wD, publicClient, Router, [factory]);
  const lom = await deploy(wD, publicClient, LOM, [router]);

  const tA_D = getContract({ address: tokenA, abi: ERCTemplate.abi, client: { public: publicClient, wallet: wD } });
  const tB_D = getContract({ address: tokenB, abi: ERCTemplate.abi, client: { public: publicClient, wallet: wD } });
  const tA_T = getContract({ address: tokenA, abi: ERCTemplate.abi, client: { public: publicClient, wallet: wT } });
  const tB_T = getContract({ address: tokenB, abi: ERCTemplate.abi, client: { public: publicClient, wallet: wT } });

  const factoryC = getContract({ address: factory, abi: Factory.abi, client: { public: publicClient, wallet: wD } });
  const routerC_D = getContract({ address: router, abi: Router.abi, client: { public: publicClient, wallet: wD } });
  const lomC_T = getContract({ address: lom, abi: LOM.abi, client: { public: publicClient, wallet: wT } });
  const lomC_D = getContract({ address: lom, abi: LOM.abi, client: { public: publicClient, wallet: wD } });

  log("Fund trader...");
  await publicClient.waitForTransactionReceipt({
    hash: await tA_D.write.transfer([trader.address, parseEther("5000")]),
  });
  await publicClient.waitForTransactionReceipt({
    hash: await tB_D.write.transfer([trader.address, parseEther("5000")]),
  });

  log("Add liquidity...");
  await publicClient.waitForTransactionReceipt({
    hash: await tA_D.write.approve([router, parseEther("1000000")]),
  });
  await publicClient.waitForTransactionReceipt({
    hash: await tB_D.write.approve([router, parseEther("1000000")]),
  });
  await publicClient.waitForTransactionReceipt({
    hash: await routerC_D.write.addLiquidity([tokenA, tokenB, parseEther("1000"), parseEther("1000"), 0n, 0n]),
  });

  const pairAddr = await factoryC.read.getPair([tokenA, tokenB]);
  assert(pairAddr !== "0x0000000000000000000000000000000000000000", "pair missing");
  const pairC = getContract({ address: pairAddr, abi: Pair.abi, client: { public: publicClient, wallet: wD } });

  const [r0, r1] = await pairC.read.getReserves();
  assert(r0 > 0n && r1 > 0n, "bad reserves");

  log("Create limit order (not fillable)...");
  const amountIn = parseEther("100");
  const quote = await routerC_D.read.getAmountsOut([amountIn, [tokenA, tokenB]]);
  const quotedOut = quote[quote.length - 1];
  const minOut = (quotedOut * 120n) / 100n;

  await publicClient.waitForTransactionReceipt({
    hash: await tA_T.write.approve([lom, amountIn]),
  });
  await publicClient.waitForTransactionReceipt({
    hash: await lomC_T.write.createOrder([tokenA, tokenB, amountIn, minOut, 0]),
  });

  const orderId = await lomC_T.read.nextOrderId();
  const fill0 = await lomC_T.read.isFillable([orderId]);
  assert(fill0[0] === false, "should NOT be fillable yet");

  log("Move price until fillable...");
  await publicClient.waitForTransactionReceipt({
    hash: await tB_D.write.approve([router, parseEther("1000000")]),
  });

  let okFill = false;
  for (let i = 0; i < 20; i++) {
    await publicClient.waitForTransactionReceipt({
      hash: await routerC_D.write.swapExactTokensForTokens([parseEther("500"), 0n, [tokenB, tokenA], deployer.address]),
    });
    const f = await lomC_T.read.isFillable([orderId]);
    if (f[0]) {
      okFill = true;
      break;
    }
  }
  assert(okFill, "still not fillable");

  log("Fill order...");
  const bBefore = await tB_T.read.balanceOf([trader.address]);

  await publicClient.waitForTransactionReceipt({
    hash: await lomC_D.write.fillOrder([orderId]),
  });

  const bAfter = await tB_T.read.balanceOf([trader.address]);
  assert(bAfter > bBefore, "trader did not receive tokenB");

  const ord = await lomC_T.read.orders([orderId]);
  const status = Number(ord[7]);
  assert(status === 1, "status not FILLED");

  log("✅ PASS");
  log("Trader gained TKB:", formatEther(bAfter - bBefore));
}

main().catch((e) => {
  console.error("❌ FAIL");
  console.error(e);
  process.exit(1);
});
