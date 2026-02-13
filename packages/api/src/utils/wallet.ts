import { ethers } from 'ethers';

export function generateWallet(): { seedPhrase: string; walletAddress: string } {
  const wallet = ethers.Wallet.createRandom();
  return {
    seedPhrase: wallet.mnemonic!.phrase,
    walletAddress: wallet.address,
  };
}

export function deriveAddress(seedPhrase: string): string {
  return ethers.Wallet.fromPhrase(seedPhrase).address;
}
