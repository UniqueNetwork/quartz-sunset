import { ApiPromise, SubmittableResult, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { KeyringPair } from "@polkadot/keyring/types";
import { readFile } from "node:fs/promises";
import { cryptoWaitReady } from "@polkadot/util-crypto/crypto";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

type Accounts = Record<string, { qtz: number; unq: number }>;

interface Params {
  url: string;
  account: KeyringPair;
  airdropPath: string;
  startFrom: number;
  batchSize: number;
};

interface SendAndFinalizeResult {
  blockHash: string;
  events: any[];
}

const rl = readline.createInterface({ input: stdin, output: stdout });

function sendAndWaitFinalized(
  sender: KeyringPair,
  extrinsic: any
): Promise<SendAndFinalizeResult> {
  return new Promise((resolve, reject) => {
    extrinsic.signAndSend(sender, (result: SubmittableResult) => {
      const { status, events } = result;

      if (status.isFinalized) {
        resolve({
          blockHash: status.asFinalized.toHex(),
          events: events.map(({ event, phase }) => ({
            section: event.section,
            method: event.method,
            data: event.data.toHuman(),
            phase: phase.toString()
          }))
        });
      } else if (status.isDropped || status.isInvalid) {
        reject(new Error(`Transaction failed with status ${status.type}`));
      }
    }).catch((error: any) => reject(error));
  });
}

async function airdropUnqs(params: Params) {
  const { url, account, airdropPath, startFrom, batchSize } = params;

  const provider = new WsProvider(url);
  const api = (await ApiPromise.create({ provider }));

  const tokenDecimals = api.registry.chainDecimals[0];

  const accounts = await readFile(airdropPath, "utf8");
  const accountsJson = JSON.parse(accounts) as Accounts;

  const entries = Object.entries(accountsJson);
  for (let i = startFrom; i < entries.length; i += batchSize) {
    const chunk = entries.slice(i, i + batchSize);
    console.log(`Processing accounts ${i} to ${i + chunk.length}`);

    const transfers = [];

    for (const [account, { unq }] of chunk) {
      const amount = BigInt(10) ** BigInt(tokenDecimals) * BigInt(unq);
      const transfer = api.tx.balances.transferKeepAlive(account, amount);
      transfers.push(transfer);
    }

    const batch = api.tx.utility.batch(transfers);
    const tx = await sendAndWaitFinalized(account, batch);

    console.log("Successfully! Block hash:", tx.blockHash);
  }
}

async function askUser(): Promise<Params> {
  const nodeUrl = await rl.question("Enter node URL (default: wss://ws.unique.network) -> ");
  const account = await rl.question("Enter sender account (default: //Alice) -> ");
  const airdropPath = await rl.question("Enter path for airdrop accounts (default: airdrop-accounts.json) -> ");
  const startFrom = await rl.question("Enter start from account (default: 0) -> ");
  const batchSize = await rl.question("Enter batch size (default: 100) -> ");

  const params = {
    url: nodeUrl || "wss://ws.unique.network",
    account: (new Keyring({ type: 'sr25519' })).addFromUri(account || "//Alice"),
    airdropPath: airdropPath || "airdrop-accounts.json",
    startFrom: parseInt(startFrom || "0"),
    batchSize: parseInt(batchSize || "100"),
  };

  if (params.startFrom < 0 || params.batchSize <= 0) {
    console.error("Invalid parameters");
    process.exit(1);
  }

  return params;
}

await cryptoWaitReady();
const params = await askUser();
await airdropUnqs(params);
process.exit(0);
