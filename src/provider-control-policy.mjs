const CONTROL_PLANE_DIRS = new Set([
  '.agents',
  '.agent',
  '_agents',
  '.antigravity'
]);

const CONTROL_PLANE_FILES = new Set([
  'agents.md',
  'gemini.md'
]);

function normalize(value) {
  return String(value ?? '')
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

export function isProviderControlPlanePath(relativePath) {
  const parts = normalize(relativePath);
  if (!parts.length) return false;

  if (parts.some((part) => CONTROL_PLANE_DIRS.has(part))) return true;

  return CONTROL_PLANE_FILES.has(parts.at(-1));
}

export const PROVIDER_CONTROL_PLANE_DIRS = [...CONTROL_PLANE_DIRS];
export const PROVIDER_CONTROL_PLANE_FILES = [...CONTROL_PLANE_FILES];
