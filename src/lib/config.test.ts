import * as config from './config.js';

describe('config', () => {
  it('exports all required rate limit constants', () => {
    expect(config.RATE_LIMIT_GENERAL).toBe(100);
    expect(config.RATE_LIMIT_WRITES).toBe(20);
    expect(config.RATE_LIMIT_UPLOADS).toBe(10);
    expect(config.RATE_LIMIT_SSE).toBe(5);
    expect(config.RATE_LIMIT_AUTH).toBe(5);
    expect(config.RATE_LIMIT_WINDOW_MS).toBe(60_000);
  });

  it('exports SSE constants', () => {
    expect(config.MAX_SSE_CONNECTIONS).toBe(500);
    expect(config.SSE_HEARTBEAT_MS).toBe(30_000);
    expect(config.SSE_DEAD_CLIENT_MS).toBe(90_000);
  });

  it('exports media constants', () => {
    expect(config.MAX_IMAGE_SIZE_BYTES).toBe(5 * 1024 * 1024);
    expect(config.MAX_VOICE_SIZE_BYTES).toBe(2 * 1024 * 1024);
    expect(config.MAX_STORAGE_BYTES).toBe(100 * 1024 * 1024);
  });

  it('exports pagination constants', () => {
    expect(config.PAGINATION_DEFAULT_LIMIT).toBe(50);
    expect(config.PAGINATION_MAX_LIMIT).toBe(200);
  });

  it('exports validation limits', () => {
    expect(config.MAX_NAME_LENGTH).toBe(200);
    expect(config.MAX_COMMENT_LENGTH).toBe(2000);
    expect(config.MIN_COMMENT_LENGTH).toBe(2);
    expect(config.MAX_PRICE).toBe(1_000_000);
    expect(config.MAX_QUANTITY).toBe(10_000);
  });

  it('DEV_MODE is true when not production and no GOOGLE_CLIENT_ID', () => {
    // In test env, NODE_ENV is 'test' and GOOGLE_CLIENT_ID is empty
    expect(config.DEV_MODE).toBe(true);
  });

  it('generates a session secret in dev mode', () => {
    expect(config.SESSION_SECRET).toBeTruthy();
    expect(config.SESSION_SECRET.length).toBeGreaterThan(10);
  });
});
