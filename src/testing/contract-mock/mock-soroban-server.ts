import { Account, Operation, rpc, xdr } from '@stellar/stellar-sdk';

export const mockSorobanServer = {
  getAccount: jest.fn<Promise<Account>, [string]>(),

  simulateTransaction: jest.fn<
    Promise<rpc.Api.SimulateTransactionResponse>,
    [unknown]
  >(),

  sendTransaction: jest.fn(),

  getTransaction: jest.fn(),

  getEvents: jest.fn(),

  reset() {
    this.getAccount.mockReset();
    this.simulateTransaction.mockReset();
    this.sendTransaction.mockReset();
    this.getTransaction.mockReset();
    this.getEvents.mockReset();
  },
};

export const mockContract = {
  call: jest.fn<Operation, [string, ...unknown[]]>(),
};

export const mockTransactionBuilder = {
  addOperation: jest.fn().mockReturnThis(),
  setTimeout: jest.fn().mockReturnThis(),
  build: jest.fn(),
};

export const mockAddress = {
  toScVal: jest.fn<xdr.ScVal, []>(),
};
