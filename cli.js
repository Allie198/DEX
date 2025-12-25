#!/usr/bin/env node
import inquirer from "inquirer";
import { createPublicClient, createWalletClient, custom, http, parseEther, getContract } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// Public Client (read işlemleri için)
const client = createPublicClient({
  chain: sepolia,
  transport: http()
});

// Kullanıcıdan wallet private key al
const { privateKey } = await inquirer.prompt([
  { type: "password", name: "privateKey", message: "Enter your wallet private key (Sepolia testnet):" }
]);

const account = privateKeyToAccount(privateKey);

const walletClient = createWalletClient({
  account,
  chain: sepolia,
  transport: http()
});

// Kontrat adresleri
const tokenAAddress = "tokenA_contract_address_here"; // Bunu token A kontrat adresinizle değiştir
const tokenBAddress = "tokenB_contract_address_here"; // Bunu token B kontrat adresinizle değiştir
const pairAddress   = "address_of_your_pair_contract_here"; // Bunu pair kontrat adresinizle değiştir

// Pair kontrat ABI
const pairABI = [
  {
    "inputs":[{"internalType":"uint256","name":"amountA","type":"uint256"},{"internalType":"uint256","name":"amountB","type":"uint256"}],
    "name":"addLiquidity",
    "outputs":[{"internalType":"uint256","name":"LP","type":"uint256"}],
    "stateMutability":"nonpayable","type":"function"
  },
  {
    "inputs":[{"internalType":"uint256","name":"LP","type":"uint256"}],
    "name":"removeLiquidity",
    "outputs":[{"internalType":"uint256","name":"amountA","type":"uint256"},{"internalType":"uint256","name":"amountB","type":"uint256"}],
    "stateMutability":"nonpayable","type":"function"
  },
  {
    "inputs":[{"internalType":"address","name":"tokenIn","type":"address"},{"internalType":"uint256","name":"amountIn","type":"uint256"},{"internalType":"uint256","name":"minOut","type":"uint256"}],
    "name":"swap",
    "outputs":[{"internalType":"uint256","name":"amountOut","type":"uint256"}],
    "stateMutability":"nonpayable","type":"function"
  },
  {
    "inputs":[],
    "name":"getReserves",
    "outputs":[{"internalType":"uint112","name":"","type":"uint112"},{"internalType":"uint112","name":"","type":"uint112"}],
    "stateMutability":"view","type":"function"
  }
];

const pairContract = getContract({ address: pairAddress, abi: pairABI, publicClient: client });

// ERC20 ABI
const tokenABI = [
  { "inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],
    "name":"approve","outputs":[{"internalType":"bool","name":"","type":"bool"}],
    "stateMutability":"nonpayable","type":"function"
  },
  { "inputs":[{"internalType":"address","name":"owner","type":"address"}],
    "name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],
    "stateMutability":"view","type":"function"
  }
];

const tokenAContract = getContract({ address: tokenAAddress, abi: tokenABI, publicClient: client });
const tokenBContract = getContract({ address: tokenBAddress, abi: tokenABI, publicClient: client });

// 6️⃣ LP Balance için
const lpABI = [
  { "inputs":[{"internalType":"address","name":"owner","type":"address"}],
    "name":"balanceOF","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],
    "stateMutability":"view","type":"function"
  }
];

const lpContract = getContract({ address: pairAddress, abi: lpABI, publicClient: client });

// Kullanıcı ve pool bilgilerini göster
const showBalances = async (userAddress) => {
  const balanceA = await tokenAContract.read.balanceOf([userAddress]);
  const balanceB = await tokenBContract.read.balanceOf([userAddress]);
  const lpBalance = await lpContract.read.balanceOF([userAddress]);
  const [reserveA, reserveB] = await pairContract.read.getReserves([]);

  console.log("\n=== Your Balances ===");
  console.log("Token A:", balanceA.toString());
  console.log("Token B:", balanceB.toString());
  console.log("Your LP Tokens:", lpBalance.toString());
  console.log("\n=== Pool Reserves ===");
  console.log("Reserve A:", reserveA.toString());
  console.log("Reserve B:", reserveB.toString(), "\n");
};

// Döngü menü
const mainMenu = async () => {
  const userAddress = account.address;
  let exit = false;

  while(!exit) {
    await showBalances(userAddress);

    const answer = await inquirer.prompt([
      { type:"list", name:"action", message:"What do you want to do?", choices:["Add Liquidity","Remove Liquidity","Swap","Exit"] }
    ]);

    // Add Liquidity
    if(answer.action === "Add Liquidity") {
      const { amountA, amountB } = await inquirer.prompt([
        { type:"input", name:"amountA", message:"Enter amountA:" },
        { type:"input", name:"amountB", message:"Enter amountB:" }
      ]);

      const a = parseEther(amountA);
      const b = parseEther(amountB);

      try {
        await tokenAContract.write.approve([pairAddress, a], { walletClient });
        await tokenBContract.write.approve([pairAddress, b], { walletClient });
        console.log("Tokens approved!");

        const tx = await pairContract.write.addLiquidity([a, b], { walletClient });
        console.log("Transaction sent! Hash:", tx.hash);
        await tx.wait();
        console.log("Liquidity added!");
      } catch(err) {
        console.error("Transaction failed:", err);
      }
    }

    // Remove Liquidity
    if(answer.action === "Remove Liquidity") {
      const { LP } = await inquirer.prompt([{ type:"input", name:"LP", message:"Enter LP amount to remove:" }]);
      const lpAmount = parseEther(LP);

      try {
        const tx = await pairContract.write.removeLiquidity([lpAmount], { walletClient });
        console.log("Transaction sent! Hash:", tx.hash);
        await tx.wait();
        console.log("Liquidity removed!");
      } catch(err) {
        console.error("Transaction failed:", err);
      }
    }

    // Swap
    if(answer.action === "Swap") {
      const { tokenIn, amountIn, minOut } = await inquirer.prompt([
        { type:"list", name:"tokenIn", message:"Select token to swap in:", choices:["Token A","Token B"] },
        { type:"input", name:"amountIn", message:"Enter amount to swap:" },
        { type:"input", name:"minOut", message:"Enter minimum output amount:" }
      ]);

      const inAddress = tokenIn === "Token A" ? tokenAAddress : tokenBAddress;
      const aIn = parseEther(amountIn);
      const minOutParsed = parseEther(minOut);

      try {
        const tokenContract = tokenIn === "Token A" ? tokenAContract : tokenBContract;
        await tokenContract.write.approve([pairAddress, aIn], { walletClient });
        console.log("Token approved!");

        const tx = await pairContract.write.swap([inAddress, aIn, minOutParsed], { walletClient });
        console.log("Transaction sent! Hash:", tx.hash);
        await tx.wait();
        console.log("Swap completed!");
      } catch(err) {
        console.error("Transaction failed:", err);
      }
    }

    if(answer.action === "Exit") {
      exit = true;
      console.log("Exiting CLI...");
    }
  }
};

mainMenu();
