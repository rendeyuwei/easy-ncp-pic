export function adminBasepath(baseUrl = import.meta.env.BASE_URL): string {
  const normalized = baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`;
  const basepath = normalized.replace(/\/+$/, '');
  return basepath || '/admin';
}

export function adminApiPath(path: string, baseUrl = import.meta.env.BASE_URL): string {
  if (!path.startsWith('/api/')) {
    throw new Error(`Admin API path must start with /api/: ${path}`);
  }
  const basepath = adminBasepath(baseUrl);
  const deploymentPrefix = basepath.endsWith('/admin') ? basepath.slice(0, -'/admin'.length) : '';
  return `${deploymentPrefix}${path}`;
}
