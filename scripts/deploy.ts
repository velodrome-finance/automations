// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from "hardhat";
import * as assert from "assert";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

const AUTOMATION_REGISTRAR_ADDRESS = process.env.AUTOMATION_REGISTRAR_ADDRESS;
const KEEPER_REGISTRY_ADDRESS = process.env.KEEPER_REGISTRY_ADDRESS;
const LINK_TOKEN_ADDRESS = process.env.LINK_TOKEN_ADDRESS;
const CRON_DELEGATE_ADDRESS = process.env.CRON_DELEGATE_ADDRESS;
const CRON_LIBRARY_ADDRESS = process.env.CRON_LIBRARY_ADDRESS;
const VOTER_ADDRESS = process.env.VOTER_ADDRESS;
const UPKEEP_FUND_AMOUNT = process.env.UPKEEP_FUND_AMOUNT;
const UPKEEP_GAS_LIMIT = process.env.UPKEEP_GAS_LIMIT;

assert.ok(AUTOMATION_REGISTRAR_ADDRESS, "AUTOMATION_REGISTRAR_ADDRESS is required");
assert.ok(KEEPER_REGISTRY_ADDRESS, "KEEPER_REGISTRY_ADDRESS is required");
assert.ok(LINK_TOKEN_ADDRESS, "LINK_TOKEN_ADDRESS is required");
assert.ok(CRON_DELEGATE_ADDRESS, "CRON_DELEGATE_ADDRESS is required");
assert.ok(CRON_LIBRARY_ADDRESS, "CRON_LIBRARY_ADDRESS is required");
assert.ok(VOTER_ADDRESS, "VOTER_ADDRESS is required");
assert.ok(UPKEEP_FUND_AMOUNT, "UPKEEP_FUND_AMOUNT is required");
assert.ok(UPKEEP_GAS_LIMIT, "UPKEEP_GAS_LIMIT is required");

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // Deploy GaugeUpkeepManager contract
  const gaugeUpkeepManagerFactory = await ethers.getContractFactory(
    "GaugeUpkeepManager",
    {
      libraries: {
        Cron: CRON_LIBRARY_ADDRESS!,
      },
    }
  );
  const gaugeUpkeepManager = await gaugeUpkeepManagerFactory.deploy(
    LINK_TOKEN_ADDRESS!,
    KEEPER_REGISTRY_ADDRESS!,
    AUTOMATION_REGISTRAR_ADDRESS!,
    CRON_DELEGATE_ADDRESS!,
    VOTER_ADDRESS!,
    UPKEEP_FUND_AMOUNT!,
    UPKEEP_GAS_LIMIT!
  );
  await gaugeUpkeepManager.deployed();

  console.log("GaugeUpkeepManager deployed to:", gaugeUpkeepManager.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
