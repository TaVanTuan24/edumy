const aiCache = require('../services/ai/aiCacheService');

describe('AI Cache Service', () => {
  afterEach(() => {
    aiCache.clear();
  });

  test('get returns null for missing key', () => {
    expect(aiCache.get('nonexistent')).toBeNull();
  });

  test('set and get stores value', () => {
    aiCache.set('key1', 'value1');
    expect(aiCache.get('key1')).toBe('value1');
  });

  test('del removes specific entry', () => {
    aiCache.set('key1', 'value1');
    aiCache.set('key2', 'value2');
    aiCache.del('key1');

    expect(aiCache.get('key1')).toBeNull();
    expect(aiCache.get('key2')).toBe('value2');
  });

  test('clear removes all entries', () => {
    aiCache.set('key1', 'value1');
    aiCache.set('key2', 'value2');
    aiCache.clear();

    expect(aiCache.get('key1')).toBeNull();
    expect(aiCache.get('key2')).toBeNull();
  });

  test('size returns current cache size', () => {
    expect(aiCache.size()).toBe(0);
    aiCache.set('a', 1);
    aiCache.set('b', 2);
    expect(aiCache.size()).toBe(2);
    aiCache.del('a');
    expect(aiCache.size()).toBe(1);
  });

  test('respects custom TTL', async () => {
    aiCache.set('short', 'value', 50); // 50ms TTL
    expect(aiCache.get('short')).toBe('value');

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 80));
    expect(aiCache.get('short')).toBeNull();
  });

  test('entry within TTL is still valid', async () => {
    aiCache.set('long', 'value', 5000); // 5 second TTL
    await new Promise((r) => setTimeout(r, 50));
    expect(aiCache.get('long')).toBe('value');
  });

  test('evicts oldest entry when at max capacity', () => {
    // Set a small max by temporarily filling cache
    for (let i = 0; i < 105; i++) {
      aiCache.set(`key-${i}`, `value-${i}`);
    }
    // Should have evicted some entries
    expect(aiCache.size()).toBeLessThanOrEqual(100);
  });
});