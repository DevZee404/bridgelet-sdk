import { Provider } from '@nestjs/common';
import { mockSorobanServer } from './mock-soroban-server.js';

export const MockContractProvider: Provider = {
  provide: 'SOROBAN_SERVER',

  useValue: mockSorobanServer,
};
