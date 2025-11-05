# Quartz Sunset

This repository has all needed information about moving accounts from Quartz network to Unique.

## Preparation

Download and install latest LTS version of [Node.js](https://nodejs.org/). Required Node.js 22+.

After this, clone the repository and run `pnpm install`.

## How to get all accounts and calculate UNQs?

Run script:

```sh
pnpm run loadAccounts
```

This script will download all accounts from the Quartz network. Then, it will ask you to choose where to save the lists of accounts for the airdrop and for the vesting contract.

## How to make an airdrop for accounts with small balances?

Run script:

```sh
pnpm run airdrop
```

This script will read the list of accounts from a previously downloaded file and send UNQ tokens to everyone in the list. The distribution is done one after another, in batches of 100 accounts.

## How to upload vesting contract?

To upload the contract, you need an account with funds on the network where you want to deploy the contract.

Before uploading, create the environment variable `PRODUCTION_PRIVATE_KEY` and add the private key of your Ethereum account there.

For testing, you can create a test account with `getTestAccount`. The script will generate a new account, top up the balance from `//Alice` with the amount you set, and show the details for connecting.

To generate a test account, run the script:

```sh
pnpm run getTestAccount --network [NETWORK]
```

To deploy contract run script:

```
pnpm run deploy --network [NETWORK]
```

Available networks:

- `localhost`, http://127.0.0.1:9699/relay-unique/.
- `devnode`, https://rpc.web.uniquenetwork.dev.
- `unique`, https://ws.unique.network.

If everything was successful, you will see the contract address and the number of uploaded accounts.

## Tests

If you want to test the contract before deploying it, this repository contains tests. To use them, you need to deploy the contract yourself and then edit the file [test/Vesting.test.ts](test/Vesting.test.ts) to set your contract address.

To run all tests, use the command:

```
pnpm run test --network [NETWORK]
```

The list of networks is shown above.
