export function webBasepath(baseUrl = import.meta.env.BASE_URL): string {
  const normalized = baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`;
  return normalized.replace(/\/+$/, '') || '/';
}

export function webPath(path: string, baseUrl = import.meta.env.BASE_URL): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${path.replace(/^\/+/, '')}`;
}
