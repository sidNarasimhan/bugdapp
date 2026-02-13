import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

// Standard test seed phrase (DO NOT USE WITH REAL FUNDS)
const SEED_PHRASE = 'test test test test test test test test test test test junk';
const PASSWORD = 'TestPassword123!';

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD);

  await metamask.importWallet(SEED_PHRASE);

  // Add Base network for Avantis testing
  await metamask.addNetwork({
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    chainId: 8453,
    symbol: 'ETH',
    blockExplorerUrl: 'https://basescan.org',
  });
});
