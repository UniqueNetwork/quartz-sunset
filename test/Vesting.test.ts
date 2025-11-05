import hre, { network } from "hardhat";
import { formatEther, getContract, parseEther } from "viem";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { addressToEvm, decodeAddress, encodeAddress, keccakAsHex, mnemonicGenerate } from "@polkadot/util-crypto";
import { hexToU8a, u8aToHex } from "@polkadot/util";
import { ApiPromise, SubmittableResult, WsProvider, Keyring } from '@polkadot/api';
import type { IKeyringPair } from '@polkadot/types/types';
import { encodeFunctionData } from "viem";
import nativeFungibleAbi from "@unique-nft/solidity-interfaces/abi/UniqueNativeFungible.json" assert { type: "json" };

// TODO: owner shouldn't be able to take donators money (emergency withdraw remove)

type CrossAddress = { eth: `0x${string}`; sub: bigint; };

describe("Vesting Contract", async function () {
  const { viem } = await network.connect();
  const vestingAbi = (await viem.getContractAt(
    "VestingNative",
    "0x1234abcd5678ef901234abcd5678ef901234abcd"
  )).abi;
  const [deployer] = await viem.getWalletClients();
  const keyring = new Keyring({type: 'sr25519', ss58Format: 42});
  const alice = keyring.addFromUri("//Alice");
  let wsProvider: WsProvider;
  let api: ApiPromise;
  const nativeFungibleAdress: `0x${string}` = "0x17c4e6453cc49aaaaeaca894e6d9683e00000000";
  const publicClient = await viem.getPublicClient();
  const nativeFungible = getContract({
    address: nativeFungibleAdress,
    abi: nativeFungibleAbi,
    client: publicClient
  });


  function crossAddress(pair: IKeyringPair): CrossAddress {
    return { sub: addressToBigint(pair.address), eth: "0x0000000000000000000000000000000000000000" };
  }

  async function deployVesting(startDelay: number = 60, durationSeconds?: bigint) {
    // Настраиваем параметры для Vesting
    const startTimestamp = BigInt(Math.floor(Date.now() / 1000) + startDelay);
    durationSeconds = durationSeconds ?? 1000n;

    // Деплоим Vesting контракт
    const vesting = await viem.deployContract("VestingNative", [
      startTimestamp,
      durationSeconds
    ]);
    return vesting;
  };

  async function wait(seconds: number) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
  }

  function bigintToAddress(big: bigint, ss58Format = 42): string {
    // 1. Convert bigint to a 32-byte public key in hex or Uint8Array
    const hex = '0x' + big.toString(16).padStart(64, '0');
    const publicKeyBytes = hexToU8a(hex);

    // 2. Encode to address
    const address = encodeAddress(publicKeyBytes, ss58Format);
    return address;
  }

  function addressToBigint(address: string | Uint8Array): bigint {
    return BigInt(u8aToHex(decodeAddress(address)));
  }

  function toChecksumAddress(address: string): `0x${string}` {
    assert(typeof address !== 'undefined');

    if(!/^(0x)?[0-9a-f]{40}$/i.test(address)) throw new Error(`Given address "${address}" is not a valid Ethereum address.`);

    address = address.toLowerCase().replace(/^0x/i, '');
    const addressHash = keccakAsHex(address).replace(/^0x/i, '');
    const checksumAddress = [];

    for(let i = 0; i < address.length; i++) {
      // If ith character is 8 to f then make it uppercase
      if(parseInt(addressHash[i], 16) > 7) {
        checksumAddress.push(address[i].toUpperCase());
      } else {
        checksumAddress.push(address[i]);
      }
    }
    return ('0x' + checksumAddress.join('')) as `0x${string}`;
  }

  function translateSubToEth(address: CrossAddress): CrossAddress {
    assert(address.sub !== 0n && address.eth == '0x0000000000000000000000000000000000000000', "Substrate part of the address cannot be zero");
    return { sub: 0n, eth: toChecksumAddress('0x' + Array.from(addressToEvm(bigintToAddress(address.sub)), i => i.toString(16).padStart(2, '0')).join(''))};
  }

  interface SendAndFinalizeResult {
  blockHash: string;
  events: any[];
}

  async function sendAndWaitFinalized(
    sender: IKeyringPair,
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

  async function sendEVMRelease(signer: IKeyringPair, contractAddress: string) {
    const data = encodeFunctionData({
      abi: vestingAbi,
      functionName: "release",
      args: [crossAddress(signer)]
    });

    return await sendEVM(signer, contractAddress, data, 0n, 500_000);
  }

  async function sendEVMDonate(signer: IKeyringPair, contractAddress: string, amount: bigint) {
    const data = encodeFunctionData({
      abi: vestingAbi,
      functionName: "donate",
      args: [crossAddress(signer)]
    });

    return await sendEVM(signer, contractAddress, data, amount, 500_000);
  }

  async function sendEVMRefundDonation(signer: IKeyringPair, contractAddress: string, amount: bigint) {
    const data = encodeFunctionData({
      abi: vestingAbi,
      functionName: "refundDonation",
      args: [crossAddress(signer), amount]
    });

    return await sendEVM(signer, contractAddress, data, 0n, 500_000);
  }

  async function sendEVM(signer: IKeyringPair, contractAddress: string, callData: string, value: bigint, gasLimit?: number) {
    if(!gasLimit) gasLimit = 2_500_000;

    const gasPrice: bigint = await publicClient.getGasPrice();
    

    const address = { sub: addressToBigint(signer.address), eth: "0x0000000000000000000000000000000000000000" as `0x${string}` };
    const tx = await api.tx.evm.call(translateSubToEth(address).eth, contractAddress, callData, value, gasLimit, gasPrice, null, null, [])
    const result = await sendAndWaitFinalized(signer, tx);
    if (result.events.find(event => event.section === 'evm' && event.method === 'ExecutedFailed')) {
      throw new Error("EVM transaction failed");
    }
    if (result.events.find(event => event.section === 'system' && event.method === 'ExtrinsicFailed')) {
      throw new Error("Substrate extrinsic failed");
    }
    return result;
  }

  before(async () => {  
    //TODO: use url from config
    wsProvider = new WsProvider("ws://127.0.0.1:9699/relay-unique/");
    api = await ApiPromise.create({ provider: wsProvider });
  });

  after(async () => {
    api.disconnect();
    wsProvider.disconnect();
  });

  describe("Deployment", function () {
    it("Should set the correct start timestamp", async function () {
      const vesting = await deployVesting();
      const start = await vesting.read.start();
      assert.ok(start > 0, `Expected start (${start}) to be greater than 0`);
    });

    it("Should set the correct duration", async function () {
      const vesting = await deployVesting();
      const duration = await vesting.read.duration();
      assert.equal(duration, 1000n, `Expected duration to be 1000 seconds`);
    });
  });

  describe("Batch Add Beneficiaries", function () {
    const user1 = keyring.addFromUri(mnemonicGenerate());
    const user2 = keyring.addFromUri(mnemonicGenerate());
    const testAddresses : readonly CrossAddress[] = [
      translateSubToEth(crossAddress(user1)),
      translateSubToEth(crossAddress(user2))
    ];

    it("Should add beneficiaries correctly", async function () {
      const vesting = await deployVesting();
      const amounts = [parseEther("10"), parseEther("10")];
      
      const hash = await vesting.write.batchAddBenefitiaries([testAddresses, amounts]);
      await publicClient.waitForTransactionReceipt({ hash });

      for (let i = 0; i < testAddresses.length; i++) {
        const allocated = await vesting.read.allocatedAmount([testAddresses[i]]);
        assert.equal(allocated, amounts[i]);
      }
    });

    it("Should reject adding beneficiaries with wrong array lengths", async function () {
      const amounts = [parseEther("10")];
      const vesting = await deployVesting();
      
      await assert.rejects(
        vesting.simulate.batchAddBenefitiaries([testAddresses, amounts]),
        (err: any) => err.cause.reason == "Arrays length mismatch"
      );
    });

    it("Should reject adding already allocated beneficiary", async function () {
      const amounts = [parseEther("10"), parseEther("10")];
      const vesting = await deployVesting();
      
      let hash = await vesting.write.batchAddBenefitiaries([testAddresses, amounts]);
      await publicClient.waitForTransactionReceipt({ hash });
      
      await assert.rejects(
        vesting.simulate.batchAddBenefitiaries([testAddresses, amounts]),
        (err: any) => err.cause.reason == "Beneficiary already has allocation"
      );
    });
  });

  describe("Donation and Release", function () {
    const donor = keyring.addFromUri(mnemonicGenerate());
    const user1 = keyring.addFromUri(mnemonicGenerate());
    const user2 = keyring.addFromUri(mnemonicGenerate());
    const user3 = keyring.addFromUri(mnemonicGenerate());
    const user1Cross = crossAddress(user1);
    const user2Cross = crossAddress(user2);
    const user1CrossEth = translateSubToEth(user1Cross);
    const user2CrossEth = translateSubToEth(user2Cross);

    async function deployWithBeneficiaries(startDelay?: number) {
      const vesting = await deployVesting(startDelay);
      const amounts = [parseEther("10"), parseEther("10")];

      const hash = await vesting.write.batchAddBenefitiaries([[user1Cross, user2Cross], amounts]);
      await publicClient.waitForTransactionReceipt({ hash });

      return vesting;
    }

    before(async () => {
      const transfer = await api.tx.balances.transferKeepAlive(donor.address, 1000_000000000000000000n);
      await sendAndWaitFinalized(alice, transfer);
    });

    it("Should allow donation", async function () {
      const vesting = await deployWithBeneficiaries();

      await sendEVMDonate(donor, vesting.address, parseEther("20"));

      const balance = await publicClient.getBalance({ address: vesting.address });
      assert.equal(balance, parseEther("20"));
    });

    it("Should allow release after donation and time", async function () {
      const vesting = await deployWithBeneficiaries();
      const transfer = await api.tx.balances.transferKeepAlive(user1.address, 2_000000000000000000n);
      await sendAndWaitFinalized(alice, transfer);
      
      // Донатим токены
      await sendEVMDonate(donor, vesting.address, parseEther("25"));

      await wait(60);
      
      // Проверяем, что можно релизить
      const releasable = await vesting.read.releasable([user1Cross]);
      assert.equal(releasable, parseEther("10"));

      // Релизим токены
      await sendEVMRelease(user1, vesting.address);

      const balance = await nativeFungible.read.balanceOfCross([user1Cross]) as bigint;
      assert(balance > parseEther("10"), `${balance} > ${parseEther("10")}`);
    });

    it("Should reject release without donation", async function () {
      const vesting = await deployWithBeneficiaries();
      await assert.rejects(
        vesting.simulate.release([user1Cross], { account: user1CrossEth.eth }),
        (err: any) => err.cause.reason == "Nothing to release"
      );
    });

    it("Should reject release before vesting started", async function () {
      const vesting = await deployWithBeneficiaries(1000);

      await sendEVMDonate(donor, vesting.address, parseEther("25"));

      await assert.rejects(
        vesting.simulate.release([user1Cross], { account: user1CrossEth.eth }),
        (err: any) => err.cause.reason == "Nothing to release"
      );
    });

    it("Should reject release after vesting ended", async function () {
      const vesting = await deployVesting(10, 10n);
      const amounts = [parseEther("10"), parseEther("10")];

      let hash = await vesting.write.batchAddBenefitiaries([[user1Cross, user2Cross], amounts]);
      await publicClient.waitForTransactionReceipt({ hash });

      await sendEVMDonate(donor, vesting.address, parseEther("25"));

      await wait(20);
      await assert.rejects(
        vesting.simulate.release([user1Cross], { account: user1CrossEth.eth }),
        (err: any) => err.cause.reason == "Nothing to release"
      );
    });

    //flaky test
    it("Should reject release with wrong signer", async function () {
      const vesting = await deployVesting(10, 1000n);
      const amounts = [parseEther("10"), parseEther("10")];

      const transfer = await api.tx.balances.transferKeepAlive(user2.address, 2_000000000000000000n);
      await sendAndWaitFinalized(alice, transfer);

      let hash = await vesting.write.batchAddBenefitiaries([[user1Cross, user2Cross], amounts]);
      await publicClient.waitForTransactionReceipt({ hash });

      await sendEVMDonate(donor, vesting.address, parseEther("25"));

      await wait(20);
      const data = encodeFunctionData({
        abi: vesting.abi,
        functionName: "release",
        args: [user1Cross]
      });

      await assert.rejects(
        sendEVM(user2, vesting.address, data, 0n, 500_000),
        (err: any) => err.message == "EVM transaction failed"
      );
    });

    it("Should reject release with wrong evm call parameter", async function () {
      const vesting = await deployVesting(10, 1000n);
      const amounts = [parseEther("10"), parseEther("10")];

      const transfer = await api.tx.balances.transferKeepAlive(user3.address, 2_000000000000000000n);
      await sendAndWaitFinalized(alice, transfer);

      let hash = await vesting.write.batchAddBenefitiaries([[user1Cross, user2Cross], amounts]);
      await publicClient.waitForTransactionReceipt({ hash });

      await sendEVMDonate(donor, vesting.address, parseEther("25"));

      await wait(20);
      const data = encodeFunctionData({
        abi: vesting.abi,
        functionName: "release",
        args: [user1Cross]
      });

      const gasPrice: bigint = await publicClient.getGasPrice();
    
      const tx = await api.tx.evm.call(user1CrossEth.eth, vesting.address, data, 0n, 500_000, gasPrice, null, null, []);
      const result = await sendAndWaitFinalized(user3, tx);

      const failedEvent = result.events.find(event => event.section === 'system' && event.method === 'ExtrinsicFailed');
      assert.ok(failedEvent, "Expected ExtrinsicFailed event");
    });
  });

  describe("Refund Donation", function () {
    const donor = keyring.addFromUri(mnemonicGenerate());
    const user1 = keyring.addFromUri(mnemonicGenerate());
    const user2 = keyring.addFromUri(mnemonicGenerate());
    const user1Cross = crossAddress(user1);
    const user2Cross = crossAddress(user2);

    async function deployWithBeneficiaries() {
      const vesting = await deployVesting();
      const amounts = [parseEther("10"), parseEther("10")];
      await vesting.write.batchAddBenefitiaries([[user1Cross, user2Cross], amounts]);
      
      await sendEVMDonate(donor, vesting.address, parseEther("20"));

      return vesting;
    }

    before(async () => {
      const transfer = await api.tx.balances.transferKeepAlive(donor.address, 1000_000000000000000000n);
      await sendAndWaitFinalized(alice, transfer);
    });

    it("Should allow refund donation", async function () {
      const vesting = await deployWithBeneficiaries();
      const dataBefore =  await api.query.system.account(donor.address);
      const initialBalance = (dataBefore.toHuman()! as any).data.free;
      
      await sendEVMRefundDonation(donor, vesting.address, parseEther("10"));
      
      const dataAfter =  await api.query.system.account(donor.address);
      const finalBalance = (dataAfter.toHuman()! as any).data.free;
      assert.ok(finalBalance > initialBalance, `${finalBalance} > ${initialBalance}`);
    });

    it("Should reject refund more than donated", async function () {
      const vesting = await deployWithBeneficiaries();
      await assert.rejects(
        sendEVMRefundDonation(donor, vesting.address, parseEther("30")),
        (err: any) => err.message == "EVM transaction failed"
      );
    });
  });
});

