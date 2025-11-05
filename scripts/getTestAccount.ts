import { network } from "hardhat";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ApiPromise, SubmittableResult, WsProvider } from "@polkadot/api";
import type { KeyringPair } from "@polkadot/keyring/types";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto/crypto";
import type { SubmittableExtrinsic } from "@polkadot/api/types";
import process from "node:process";
import { evmToAddress } from "@polkadot/util-crypto";

interface Params {
  amount: number;
}

const rl = readline.createInterface({ input: stdin, output: stdout });

function sendAndWaitFinalized(
  sender: KeyringPair,
  extrinsic: SubmittableExtrinsic<"promise">
): Promise<void> {
  return new Promise((resolve, reject) => {
    extrinsic.signAndSend(sender, (result: SubmittableResult) => {
      const { status } = result;

      if (status.isFinalized) {
        resolve(undefined);
      } else if (status.isDropped || status.isInvalid) {
        reject(new Error(`Transaction failed with status ${status.type}`));
      }
    }).catch((error: Error) => reject(error));
  });
}

async function main(params: Params) {
  const { amount } = params;

  const { networkConfig } = await network.connect();

  let url = await (networkConfig as any).url?.get();
  if (!url) {
    throw new Error("No RPC url configured for network");
  }

  if (url.startsWith("http://")) url = url.replace("http://", "ws://");
  if (url.startsWith("https://")) url = url.replace("https://", "wss://");

  await cryptoWaitReady();
  const provider = new WsProvider(url);
  const api = await ApiPromise.create({ provider });

  const keyring = new Keyring({ type: 'sr25519', ss58Format: 42 });
  const alice = keyring.addFromUri("//Alice");

  console.log("Creating test account...");

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const substrateAddress = evmToAddress(account.address);

  const tokenDecimals = api.registry.chainDecimals[0] || 18;
  const amountWithDecimals = BigInt(amount) * (BigInt(10) ** BigInt(tokenDecimals));

  const transfer = api.tx.balances.transferKeepAlive(substrateAddress, amountWithDecimals);
  await sendAndWaitFinalized(alice, transfer);

  console.log("Account created successfully!");
  console.log("Public key (address):", account.address);
  console.log("Substrate address:", substrateAddress)
  console.log("Private key:", privateKey);
}

async function askUser(): Promise<Params> {
  const amount = await rl.question("Enter amount (default: 30000) -> ");

  return {
    amount: parseInt(amount || "30000"),
  };
}

const params = await askUser();
await main(params);
process.exit(0);
