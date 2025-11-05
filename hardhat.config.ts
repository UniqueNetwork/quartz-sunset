import type { HardhatUserConfig } from "hardhat/config";
import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import "@nomicfoundation/hardhat-viem-assertions";

import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";

const accounts = [process.env.PRODUCTION_PRIVATE_KEY].filter((x): x is string => !!x);

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxViem],
  solidity: {
    version: "0.8.23",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    hardhatMainnet: {
      url: "",
      type: "edr-simulated",
      chainType: "l1",
    },
    unique: {
      url: "https://ws.unique.network",
      chainType: "l1",
      type: "http",
      chainId: 8880,
      accounts,
    },
    devnode: {
      url: "https://rpc.web.uniquenetwork.dev",
      chainType: "l1",
      type: "http",
      chainId: 8882,
      accounts,
    },
    localhost: {
      url: "http://127.0.0.1:9699/relay-unique/",
      chainId: 8880,
      chainType: "l1",
      type: "http",
      accounts: accounts.length > 0 ? accounts : undefined,
    },
  },
  ignition: {
    disableFeeBumping: true,
  }
};

export default config;
