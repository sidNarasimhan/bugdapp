/**
 * Account management tests using dappwright.
 *
 * Demonstrates how to:
 * - Create additional accounts
 * - Switch between accounts
 * - Import a private key
 * - Lock and unlock the wallet
 * - Delete accounts
 * - Get token balances
 */

import { test, expect } from '../../fixtures/wallet.fixture';

test.describe('Account Management', () => {
  test('should create a new account', async ({ wallet }) => {
    // createAccount() adds a new account in MetaMask
    // Optionally accepts a name parameter
    await wallet.createAccount('Test Account 2');
    console.log('Created "Test Account 2" via dappwright');
  });

  test('should switch between accounts', async ({ wallet }) => {
    // Create a second account if needed
    await wallet.createAccount('Secondary');

    // switchAccount() selects the account by name
    await wallet.switchAccount('Account 1');
    console.log('Switched to Account 1');

    await wallet.switchAccount('Secondary');
    console.log('Switched to Secondary account');
  });

  test('should import a private key', async ({ wallet }) => {
    // importPK() imports an account from a private key
    // Hardhat's second account private key:
    await wallet.importPK(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
    );
    console.log('Imported account from private key');
  });

  test('should lock and unlock the wallet', async ({ wallet }) => {
    // lock() locks MetaMask
    await wallet.lock();
    console.log('Wallet locked');

    // unlock() unlocks with password (defaults to 'password1234')
    await wallet.unlock('password1234');
    console.log('Wallet unlocked');
  });

  test('should delete an account', async ({ wallet }) => {
    // Create a temporary account
    await wallet.createAccount('Temp Account');

    // deleteAccount() removes the specified account
    await wallet.deleteAccount('Temp Account');
    console.log('Deleted Temp Account');
  });

  test('should get token balance', async ({ wallet }) => {
    // getTokenBalance() returns the balance for a specific token symbol
    const balance = await wallet.getTokenBalance('ETH');
    console.log(`ETH balance: ${balance}`);
    expect(typeof balance).toBe('number');
  });
});
