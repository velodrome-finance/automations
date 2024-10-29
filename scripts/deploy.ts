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
const LINK_TOKEN_ADDRESS = process.env.LINK_TOKEN_ADDRESS;
const CRON_DELEGATE_ADDRESS = process.env.CRON_DELEGATE_ADDRESS;
const CRON_LIBRARY_ADDRESS = process.env.CRON_LIBRARY_ADDRESS;

assert.ok(AUTOMATION_REGISTRAR_ADDRESS, "AUTOMATION_REGISTRAR_ADDRESS is required");
assert.ok(LINK_TOKEN_ADDRESS, "LINK_TOKEN_ADDRESS is required");
assert.ok(CRON_DELEGATE_ADDRESS, "CRON_DELEGATE_ADDRESS is required");
assert.ok(CRON_LIBRARY_ADDRESS, "CRON_LIBRARY_ADDRESS is required");

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // Deploy CronUpkeepManager contract
  const cronUpkeepManagerFactory = await ethers.getContractFactory(
    "CronUpkeepManager",
    {
      libraries: {
        Cron: CRON_LIBRARY_ADDRESS,
      },
    }
  );
  const cronUpkeepManager = await cronUpkeepManagerFactory.deploy(
    LINK_TOKEN_ADDRESS,
    AUTOMATION_REGISTRAR_ADDRESS,
    CRON_DELEGATE_ADDRESS
  );
  await cronUpkeepManager.waitForDeployment();
  const cronUpkeepManagerAddress = await cronUpkeepManager.getAddress();

  console.log("CronUpkeepManager deployed to:", cronUpkeepManagerAddress);

  // --------------------------------------------------------------------------
  // For live testing purposes - will be removed
  // --------------------------------------------------------------------------

  // 1. Fund the CronUpkeepManager contract with LINK
  const token = await ethers.getContractAt(
    ["function transfer(address to, uint256 amount) external returns (bool)"],
    LINK_TOKEN_ADDRESS
  );
  const transferTx = await token.transfer(
    cronUpkeepManagerAddress,
    ethers.parseEther("2")
  );
  await transferTx.wait();

  // 2. Register a test cron upkeep
  const testRegisterTx = await cronUpkeepManager.__testRegisterUpkeep();
  const testRegisterReceipt = await testRegisterTx.wait();
  const upkeepId = testRegisterReceipt.logs.find(
    (log) =>
      log.topics[0] ===
      "0xc9f64f14c272e1637e7c4130f94d3f37b946a12325abcea15002b38706af60b0"
  )?.args[0];
  console.log(
    "Test Upkeep URL:",
    `https://automation.chain.link/optimism-sepolia/${upkeepId}`
  );
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
