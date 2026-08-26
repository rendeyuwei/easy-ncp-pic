import { describe, expect, it } from 'vitest';
import { adminApiPath, adminBasepath } from '../lib/deployment-paths';

describe('admin deployment paths', () => {
  it('keeps the existing root-level admin and API paths', () => {
    expect(adminBasepath('/')).toBe('/admin');
    expect(adminBasepath('/admin/')).toBe('/admin');
    expect(adminApiPath('/api/admin/session', '/admin/')).toBe('/api/admin/session');
  });

  it('places admin routing and API requests below a deployment prefix', () => {
    expect(adminBasepath('/easypic/admin/')).toBe('/easypic/admin');
    expect(adminApiPath('/api/admin/session', '/easypic/admin/')).toBe('/easypic/api/admin/session');
  });

  it('rejects paths outside the API boundary', () => {
    expect(() => adminApiPath('/filters', '/easypic/admin/')).toThrow('must start with /api/');
  });
});
