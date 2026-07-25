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
};

export function resetMockSorobanServer() {
  mockSorobanServer.getAccount.mockReset();
  mockSorobanServer.simulateTransaction.mockReset();
  mockSorobanServer.sendTransaction.mockReset();
  mockSorobanServer.getTransaction.mockReset();
  mockSorobanServer.getEvents.mockReset();
}

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
