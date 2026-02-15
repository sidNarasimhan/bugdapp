/**
 * Signature and transaction tests using dappwright.
 *
 * Demonstrates how to:
 * - Sign messages (personal_sign)
 * - Sign typed data (eth_signTypedData_v4)
 * - Confirm transactions (eth_sendTransaction)
 * - Confirm transactions with custom gas settings
 *
 * Uses the official MetaMask Test Dapp for all interactions.
 */

import { test, expect } from '../../fixtures/wallet.fixture';

test.describe('MetaMask Test Dapp - Signatures & Transactions', () => {
  test.beforeEach(async ({ wallet, page }) => {
    await page.goto('https://metamask.github.io/test-dapp/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Connect wallet first (required for signing and transactions)
    await page.locator('#connectButton').click();
    await wallet.approve();

    // Verify connected
    const accounts = page.locator('#accounts');
    await expect(accounts).not.toBeEmpty();
  });

  test('should sign a personal message', async ({ wallet, page }) => {
    // The test dapp has a "Personal Sign" button
    await page.locator('#personalSign').click();
    console.log('Clicked Personal Sign on dApp');

    // dappwright's sign() handles the MetaMask signature popup
    await wallet.sign();
    console.log('Signed message via dappwright');

    // Verify the signature result is populated
    const result = page.locator('#personalSignResult');
    await expect(result).not.toBeEmpty();

    const signature = await result.textContent();
    console.log(`Signature: ${signature?.substring(0, 20)}...`);
    expect(signature).toMatch(/^0x/);
  });

  test('should sign typed data v4', async ({ wallet, page }) => {
    // Click signTypedDataV4 on the test dapp
    await page.locator('#signTypedDataV4').click();
    console.log('Clicked Sign Typed Data V4 on dApp');

    // sign() also handles typed data signing popups
    await wallet.sign();
    console.log('Signed typed data via dappwright');

    const result = page.locator('#signTypedDataV4Result');
    await expect(result).not.toBeEmpty();
  });

  test('should handle SIWE signin flow', async ({ wallet, page }) => {
    // If the dApp has a SIWE (Sign-In with Ethereum) flow
    // dappwright provides signin() which handles the connect + sign combo
    await page.locator('#siwe').click();
    console.log('Clicked SIWE button on dApp');

    // signin() handles the combined connect/sign flow that SIWE uses
    await wallet.signin();
    console.log('Completed SIWE signin via dappwright');

    const result = page.locator('#siweResult');
    await expect(result).not.toBeEmpty();
  });

  test('should confirm a transaction', async ({ wallet, page }) => {
    // Send a simple ETH transfer via the test dapp
    await page.locator('#sendButton').click();
    console.log('Clicked Send ETH on dApp');

    // confirmTransaction() waits for the MetaMask transaction popup
    // and clicks the confirm button
    await wallet.confirmTransaction();
    console.log('Confirmed transaction via dappwright');

    // The test dapp should show a transaction hash
    const txStatus = page.locator('#transactionResult');
    await expect(txStatus).not.toBeEmpty();
  });

  test('should confirm a transaction with custom gas', async ({
    wallet,
    page,
  }) => {
    await page.locator('#sendButton').click();
    console.log('Clicked Send ETH on dApp');

    // confirmTransaction() accepts optional gas parameters
    await wallet.confirmTransaction({
      gas: 30, // Max base fee in gwei
      gasLimit: 21000, // Gas limit
      priority: 2, // Priority fee in gwei
    });
    console.log('Confirmed transaction with custom gas via dappwright');

    const txStatus = page.locator('#transactionResult');
    await expect(txStatus).not.toBeEmpty();
  });
});
