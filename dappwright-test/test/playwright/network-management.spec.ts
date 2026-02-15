/**
 * Network management tests using dappwright.
 *
 * Demonstrates how to:
 * - Add a custom network (e.g., Polygon, Arbitrum, localhost)
 * - Switch between networks
 * - Confirm dApp-initiated network switches
 * - Delete networks
 * - Check if a network exists
 * - Update RPC URLs for existing networks
 *
 * These are the areas where Synpress had the most problems with MetaMask v11.9.1 selectors.
 * dappwright handles all of this through its clean API with proper MetaMask v13 selectors.
 */

import { test, expect } from '../../fixtures/wallet.fixture';

test.describe('Network Management', () => {
  test('should add a custom network', async ({ wallet }) => {
    // dappwright's addNetwork() navigates to MetaMask settings,
    // fills in the network form, and saves it.
    // This replaces the brittle CSS selector approach Synpress used.
    await wallet.addNetwork({
      networkName: 'Polygon Mainnet',
      rpc: 'https://polygon-rpc.com',
      chainId: 137,
      symbol: 'MATIC',
    });

    console.log('Added Polygon network via dappwright');

    // Verify the network was added
    const hasPolygon = await wallet.hasNetwork('Polygon Mainnet');
    expect(hasPolygon).toBe(true);
  });

  test('should switch to a different network', async ({ wallet }) => {
    // First add a network if it doesn't exist
    const hasPolygon = await wallet.hasNetwork('Polygon Mainnet');
    if (!hasPolygon) {
      await wallet.addNetwork({
        networkName: 'Polygon Mainnet',
        rpc: 'https://polygon-rpc.com',
        chainId: 137,
        symbol: 'MATIC',
      });
    }

    // switchNetwork() opens the network dropdown in MetaMask
    // and clicks on the specified network name
    await wallet.switchNetwork('Polygon Mainnet');
    console.log('Switched to Polygon via dappwright');
  });

  test('should confirm dApp-initiated network switch', async ({
    wallet,
    page,
  }) => {
    // Navigate to a dApp that requests network switches
    await page.goto('https://metamask.github.io/test-dapp/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Connect first
    await page.locator('#connectButton').click();
    await wallet.approve();

    // When a dApp calls wallet_switchEthereumChain,
    // MetaMask shows a confirmation popup.
    // confirmNetworkSwitch() handles that popup.
    //
    // This replaces our custom handleNetworkSwitch() helper
    // which used brittle CSS selectors.

    // Trigger network switch from the dApp
    // (the test dapp has chain switching buttons)
    await page.locator('#switchEthereumChain').click();
    await wallet.confirmNetworkSwitch();
    console.log('Confirmed network switch from dApp via dappwright');
  });

  test('should delete a network', async ({ wallet }) => {
    // Ensure network exists first
    const hasNetwork = await wallet.hasNetwork('Polygon Mainnet');
    if (!hasNetwork) {
      await wallet.addNetwork({
        networkName: 'Polygon Mainnet',
        rpc: 'https://polygon-rpc.com',
        chainId: 137,
        symbol: 'MATIC',
      });
    }

    // Switch back to Ethereum mainnet before deleting
    await wallet.switchNetwork('Ethereum Mainnet');

    // deleteNetwork() navigates to settings, finds the network, and removes it
    await wallet.deleteNetwork('Polygon Mainnet');
    console.log('Deleted Polygon network via dappwright');

    // Verify it's gone
    const stillHas = await wallet.hasNetwork('Polygon Mainnet');
    expect(stillHas).toBe(false);
  });

  test('should update an existing network RPC URL', async ({ wallet }) => {
    // Add a network first
    await wallet.addNetwork({
      networkName: 'Localhost 8545',
      rpc: 'http://127.0.0.1:8545',
      chainId: 31337,
      symbol: 'ETH',
    });

    // updateNetworkRpc() finds the network by chainId and replaces the RPC URL
    // This is useful for switching between different RPC providers
    await wallet.updateNetworkRpc({
      chainId: 31337,
      rpc: 'http://127.0.0.1:9545',
    });
    console.log('Updated localhost RPC URL via dappwright');
  });

  test('should add localhost network for Hardhat', async ({ wallet }) => {
    // This is the typical setup for local development testing
    await wallet.addNetwork({
      networkName: 'Hardhat Local',
      rpc: 'http://127.0.0.1:8545',
      chainId: 31337,
      symbol: 'ETH',
    });

    await wallet.switchNetwork('Hardhat Local');
    console.log('Switched to Hardhat Local network');
  });
});
