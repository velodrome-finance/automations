# Velodrome Automation

This repository contains the scripts designed to automate the Velodrome ecosystem using Chainlink oracles.

## Components

### Emissions

- **GaugeUpkeepManager**: This contract is responsible for registering and deregistering scheduled distribute call upkeeps for a gauge. It is registered as an upkeep itself with the following triggers:
  - Log triggers (from the `Voter` contract)
    - `GaugeCreated`: Registers a new gauge in the upkeep manager when it is created.
    - `GaugeKilled`: Deregisters an existing gauge from the upkeep manager when it is killed.
    - `GaugeRevived`: Registers a gauge in the upkeep manager when it is revived.
- **GaugeUpkeep**: This contract is the actual upkeep that calls the `distribute` function on gauges. It iterates over a range of gauge IDs and is triggered on an interval.

### Prices

- **TokenUpkeepManager**: This contract is responsible for managing a whitelist of tokens and their corresponding upkeeps. It registers and deregisters upkeeps for token price updates. It is registered as an upkeep itself with the following trigger:
  - Log trigger (from the `Voter` contract)
    - `WhitelistToken`: Registers or deregisters a token in the upkeep manager when it is whitelisted or removed from the whitelist.
- **TokenUpkeep**: This contract is the actual upkeep that calls the `fetchPrices` function on tokens. It iterates over a range of token IDs and is triggered on an interval.

### Utility

- **UpkeepBalanceMonitor**: This is a utility contract that watches the balances of all active gauge upkeeps and triggers top-up transactions when the balance falls below a certain threshold.

## Installation

This repository uses [Hardhat](https://hardhat.org/) as the development environment.

1. Install the dependencies:

```bash
pnpm install
```

2. Install submodules:

```bash
git submodule update --init --recursive
```

## Configuration

Copy the example configuration and fill in the required environment variables:

```bash
cp .env.example .env
```

## Testing

Tests are executed using Hardhat.

1. Run the unit tests:

```bash
pnpm run test:unit
```

2. Run the script tests on a forked network:

```bash
pnpm run test:fork
pnpm run test:fork:v2_3
```

## Deployment

### Upkeep Balance Monitor

1. Deploy the `UpkeepBalanceMonitor` contract by running:

```bash
npx hardhat run scripts/deploy_balance_monitor.ts --network <network>
```

2. Register custom logic trigger for the deployed `UpkeepBalanceMonitor` contract and set the trusted forwarders:

```bash
npx hardhat run scripts/<version>/register_monitor_upkeep.ts --network <network>
```

**Note:** Currently supported Chainlink Automation versions are `v2_1` and `v2_3`.  
**Note:** The account running the script must have enough LINK to pay for the initial upkeep registration funding determined by the `BALANCE_MONITOR_UPKEEP_FUND_AMOUNT` and `BALANCE_MONITOR_UPKEEP_GAS_LIMIT` environment variables.

3. Transfer LINK tokens to the `UpkeepBalanceMonitor` contract which will be used to top-up the gauge upkeeps.

### Gauge Upkeep Manager

1. Deploy and configure `GaugeUpkeepManager` contract by running:

```bash
npx hardhat run scripts/emissions/<version>/deploy_upkeep_manager.ts --network <network>
```

2. Register log trigger upkeeps for the deployed `GaugeUpkeepManager` contract and set the trusted forwarders:

```bash
npx hardhat run scripts/emissions/<version>/register_log_upkeeps.ts --network <network>
```

**Note:** Make sure the account running the script has enough LINK to pay for the initial funding of each upkeep registration determined by the `LOG_UPKEEP_FUND_AMOUNT` and `LOG_UPKEEP_GAS_LIMIT` environment variables.

3. Transfer LINK tokens to the `GaugeUpkeepManager` contract for new gauge upkeep registrations. The amount of LINK required is determined by the `NEW_UPKEEP_FUND_AMOUNT` environment variable.

### Token Upkeep Manager

1. Deploy and configure `TokenUpkeepManager` contract by running:

```bash
npx hardhat run scripts/prices/deploy_upkeep_manager.ts --network <network>
```

2. Register log trigger upkeep for the deployed `TokenUpkeepManager` contract and set the trusted forwarder:

```bash
npx hardhat run scripts/prices/register_log_upkeep.ts --network <network>
```

**Note:** Make sure the account running the script has enough LINK to pay for the initial upkeep registration determined by the `LOG_UPKEEP_FUND_AMOUNT` and `LOG_UPKEEP_GAS_LIMIT` environment variables.

3. Transfer LINK tokens to the `TokenUpkeepManager` contract for new token upkeep registrations. The amount of LINK required is determined by the `NEW_UPKEEP_FUND_AMOUNT` environment variable.

4. Register tokens in the `TokenUpkeepManager` contract by running:

```bash
npx hardhat run scripts/prices/register_tokens.ts --network <network>
```

**Note:** The script reads the token addresses stored in `logs/tokens.json` file.

5. Add `TokenUpkeepManager` as a keeper to the `Prices` contract, so it can call the `storePrice` function. This is done by calling the `addKeeper` function on the `Prices` contract with the address of the `TokenUpkeepManager` contract as an argument.
