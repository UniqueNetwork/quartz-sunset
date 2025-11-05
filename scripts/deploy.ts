import { network } from "hardhat";
import { readFile } from "fs/promises";
import process from "node:process";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { decodeAddress } from '@polkadot/util-crypto';
import { u8aToHex } from '@polkadot/util';

const rl = readline.createInterface({ input: stdin, output: stdout });

interface Params {
  accounts: Record<string, { qtz: number; unq: number }>;
  start: Date;
  end: Date;
}

function substrateAddressToCrossAddress(address: string): { eth: `0x${string}`, sub: bigint } {
    const publicKey = decodeAddress(address);
    const publicKeyHex = u8aToHex(publicKey);
    return {
        eth: '0x0000000000000000000000000000000000000000',
        sub: BigInt(publicKeyHex)
    };
}

async function main(params: Params) {
  const { accounts, start, end } = params;
  
  const oneUnq = 10n ** 18n;

  const { viem } = await network.connect();

  const wallets = await viem.getWalletClients();
  if (wallets.length === 0) {
    throw new Error("PRODUCTION_PRIVATE_KEY is not set");
  }

  console.log("");

  const deployer = wallets[0];
  console.log("Deployer and donor account:", deployer.account.address);

  const publicClient = await viem.getPublicClient();
  const balance = await publicClient.getBalance({ address: deployer.account.address });
  console.log("Account balance:", balance / oneUnq, "UNQ");


  let continueDeploy = await rl.question("Continue deploy with this account? (y/n) ");
  if (continueDeploy.trim().toLowerCase() != 'y') {
    return;
  }


  const numberOfBeneficiaries = Object.keys(accounts).length;
  const totalAllocation = Object.values(accounts).reduce((acc, account) => acc + BigInt(account.unq), BigInt(0));

  console.log("");
  console.log("Number of beneficiaries:", numberOfBeneficiaries);
  console.log("Total allocation:", totalAllocation, "UNQ");
  console.log("Start date:", start.toISOString());
  console.log("End date:", end.toISOString());

  const startTimestamp = start.getTime() / 1000;
  const durationSeconds = Math.ceil((end.getTime() - start.getTime()) / 1000);

  console.log("Start timestamp:", startTimestamp);
  console.log("Duration (seconds):", durationSeconds);

  continueDeploy = await rl.question("Are you sure you want to deploy contract with these parameters? (y/n) ");
  if (continueDeploy.trim().toLowerCase() != 'y') {
    return;
  }


  console.log("\nStep 1. Deploying contract...");

  const vesting = await viem.deployContract("VestingNative", [
    BigInt(startTimestamp),
    BigInt(durationSeconds)
  ]);

  console.log("✅ Contract successfully deployed! Address:", vesting.address);


  console.log("");
  console.log("Step 2. Adding beneficiaries...");
  
  const beneficiaries = Object.keys(accounts).map(substrateAddressToCrossAddress);
  const amounts = Object.values(accounts).map(account => BigInt(account.unq) * oneUnq);

  const BATCH_SIZE = 250;
  for (let i = 0; i < beneficiaries.length; i += BATCH_SIZE) {
    const batchBeneficiaries = beneficiaries.slice(i, i + BATCH_SIZE);
    const batchAmounts = amounts.slice(i, i + BATCH_SIZE);

    const hash = await vesting.write.batchAddBenefitiaries([
      batchBeneficiaries,
      batchAmounts
    ]);

    console.log(`Transaction hash for batch ${i}..${i + BATCH_SIZE}:`, hash);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ Added part of beneficiaries in block:`, receipt.blockNumber);
  }

  console.log("All beneficiaries added!");


  console.log("All done!");
}

async function getParams(): Promise<Params> {
  const accountsFile = await rl.question("Enter path to accounts file (default: contract-accounts.json) -> ");

  let accounts;
  try {
    const filePath = accountsFile || "contract-accounts.json";
    const fileContent = await readFile(filePath, "utf-8");
    accounts = JSON.parse(fileContent);
  } catch (err) {
    throw new Error(`Failed to read or parse accounts file`, {cause: err});
  }

  return {
    accounts: accounts,
    start: new Date(Date.UTC(2025, 10, 5, 14, 30)),
    end: new Date(Date.UTC(2026, 3, 1)),
  };
}

const params = await getParams();
await main(params);
process.exit(0);
