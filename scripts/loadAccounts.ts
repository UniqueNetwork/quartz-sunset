import { ApiPromise, WsProvider } from "@polkadot/api";
import { encodeAddress } from "@polkadot/util-crypto";
import { writeFile } from 'node:fs/promises';
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

type AccountData = {
  data: {
    free: string | number;
    reserved: string | number;
  };
};

interface Params {
  url: string;
  block: number;
  contractPath: string;
  airdropPath: string;
  statsPath: string;
}

const rl = readline.createInterface({ input: stdin, output: stdout });

function toQTZ(value: bigint): number {
  const decimals = 18;

  const s = value.toString();
  if (s.length <= decimals) {
    const frac = s.padStart(decimals, "0");
    return Number(`0.${frac}`);
  } else {
    const intPart = s.slice(0, s.length - decimals);
    const fracPart = s.slice(s.length - decimals);
    return Number(`${intPart}.${fracPart}`);
  }
}

async function loadAccounts(url: string, block: number): Promise<Record<string, AccountData>> {
  const provider = new WsProvider(url);
  const api = (await ApiPromise.create({ provider }));

  const blockHash = await api.rpc.chain.getBlockHash(block);
  const api_at_block = await api.at(blockHash);

  console.log("Loading accounts...");

  const list = (await api_at_block.query.system.account.entries())
    .map(([key, value]) => ({
      key: encodeAddress(key.args[0].toString()),
      value: value.toJSON() as any,
    }));

  console.log(`Successfully loaded ${list.length} accounts from ${url}`);

  const accounts: Record<string, AccountData> = {};
  for (const { key, value } of list) {
    accounts[key] = value;
  }

  return accounts;
}

async function processAccounts(params: Params) {
  const { url, block, contractPath, airdropPath, statsPath } = params;

  const accounts = await loadAccounts(url, block);

  const threshold = 25;     // QTZ
  const exchangeRate = 25;  // QTZ for 1 UNQ

  const contract: Record<string, { qtz: number; unq: number }> = {};
  const airdrop: Record<string, { qtz: number; unq: number }> = {};

  const stats = {
    less25: 0,
    contractUnq: 0,
    airdropUnq: 0,
  };

  for (const [account, value] of Object.entries(accounts)) {
    const free = BigInt(value.data.free);
    const reserved = BigInt(value.data.reserved);

    const qtz = toQTZ(free + reserved);
    const unq = qtz > 0 ? Math.ceil(qtz / exchangeRate) : 1;

    const balance = { qtz, unq };

    if (qtz < 25) stats.less25 += 1;

    if (qtz > threshold) {
      stats.contractUnq += unq;
      contract[account] = balance;
    } else {
      stats.airdropUnq += unq;
      airdrop[account] = balance;
    }
  }

  console.log("Number of contract accounts:", Object.keys(contract).length);
  console.log("UNQs required for contract:", stats.contractUnq);
  console.log("-------------------------------------------------");
  console.log("UNQs required for airdrop:", stats.airdropUnq);
  console.log("Number of airdrop accounts:", Object.keys(airdrop).length);
  console.log("-------------------------------------------------");

  console.log("Saving data to json files...");
  await writeFile(contractPath, JSON.stringify(contract));
  await writeFile(airdropPath, JSON.stringify(airdrop));
  await writeFile(statsPath, JSON.stringify(stats));
  console.info("Saved!");
}

async function askUser() {
  const nodeUrl = await rl.question("Enter node URL (default: wss://eu-ws-quartz.unique.network/) -> ");
  const block = await rl.question("Enter block number (default: 10631635) -> ");
  const contractPath = await rl.question("Enter path for contract accounts (default: contract-accounts.json) -> ");
  const airdropPath = await rl.question("Enter path for airdrop accounts (default: airdrop-accounts.json) -> ");
  const statsPath = await rl.question("Enter path for stats file (default: stats.json) -> ");

  return {
    url: nodeUrl || "wss://eu-ws-quartz.unique.network/",
    block: parseInt(block || "10631635"),
    contractPath: contractPath || "contract-accounts.json",
    airdropPath: airdropPath || "airdrop-accounts.json",
    statsPath: statsPath || "stats.json"
  };
}

const params = await askUser();
await processAccounts(params);
process.exit(0);
