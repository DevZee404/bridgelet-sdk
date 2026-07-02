import { jest } from '@jest/globals';

// Mock OpenTelemetry SDK before importing tracing module
const mockStart = jest.fn();
const mockShutdown = jest.fn().mockResolvedValue(undefined);

jest.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: jest.fn().mockImplementation(() => ({
    start: mockStart,
    shutdown: mockShutdown,
  })),
}));
jest.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: jest.fn().mockReturnValue([]),
}));
jest.mock('@opentelemetry/exporter-trace-otlp-grpc', () => ({
  OTLPTraceExporter: jest.fn().mockImplementation(() => ({})),
}));

describe('tracing', () => {
  beforeEach(() => {
    jest.resetModules();
    mockStart.mockClear();
  });

  it('starts the SDK when OTEL_ENABLED is not false', async () => {
    process.env.OTEL_ENABLED = 'true';
    await import('./tracing.js');
    expect(mockStart).toHaveBeenCalled();
    delete process.env.OTEL_ENABLED;
  });

  it('does not start the SDK when OTEL_ENABLED=false', async () => {
    jest.resetModules();
    process.env.OTEL_ENABLED = 'false';
    mockStart.mockClear();
    await import('./tracing.js');
    expect(mockStart).not.toHaveBeenCalled();
    delete process.env.OTEL_ENABLED;
  });
});
