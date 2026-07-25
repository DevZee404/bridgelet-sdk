import { jest } from '@jest/globals';
import {
  RequestIdMiddleware,
  REQUEST_ID_HEADER,
} from './request-id.middleware.js';
import {
  requestContextStorage,
  getRequestId,
} from '../context/request-context.js';
import type { Request, Response } from 'express';

function makeReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function makeRes(): { setHeader: jest.Mock; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: jest.fn((k: string, v: string) => {
      headers[k] = v;
    }),
  };
}

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
  });

  it('propagates X-Request-Id from incoming request', (done) => {
    const req = makeReq({ [REQUEST_ID_HEADER]: 'my-id-123' });
    const res = makeRes();

    middleware.use(req, res as unknown as Response, () => {
      expect(res.setHeader).toHaveBeenCalledWith(
        REQUEST_ID_HEADER,
        'my-id-123',
      );
      done();
    });
  });

  it('generates a UUID when X-Request-Id is absent', (done) => {
    const req = makeReq();
    const res = makeRes();

    middleware.use(req, res as unknown as Response, () => {
      const id = res.headers[REQUEST_ID_HEADER];
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      done();
    });
  });

  it('makes requestId available via getRequestId() inside next()', (done) => {
    const req = makeReq({ [REQUEST_ID_HEADER]: 'ctx-id-456' });
    const res = makeRes();

    middleware.use(req, res as unknown as Response, () => {
      expect(getRequestId()).toBe('ctx-id-456');
      done();
    });
  });

  it('getRequestId() returns undefined outside request context', () => {
    expect(requestContextStorage.getStore()).toBeUndefined();
    expect(getRequestId()).toBeUndefined();
  });
});
