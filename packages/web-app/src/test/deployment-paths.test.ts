import { describe, expect, it } from 'vitest';
import { webBasepath, webPath } from '../lib/deployment-paths';

describe('web deployment paths', () => {
  it('keeps root deployments unchanged', () => {
    expect(webBasepath('/')).toBe('/');
    expect(webPath('api/filters', '/')).toBe('/api/filters');
  });

  it('places API requests below the configured deployment prefix', () => {
    expect(webBasepath('/easypic/')).toBe('/easypic');
    expect(webPath('', '/easypic/')).toBe('/easypic/');
    expect(webPath('/api/filters', '/easypic/')).toBe('/easypic/api/filters');
  });
});
