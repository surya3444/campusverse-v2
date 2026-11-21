// Addresses of the public product pages: /product/<system>/<module>, in kebab case.
import { SYSTEMS, type AppEntry, type SystemEntry } from '../../lib/systems';

export const slug = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
export const systemHref = (system: string) => `/product/${slug(system)}`;
export const moduleHref = (system: string, module: string) =>
  `/product/${slug(system)}/${slug(module)}`;

export function findSystem(systemSlug: string): SystemEntry | undefined {
  return SYSTEMS.find((s) => slug(s.key) === systemSlug);
}

export function findModule(
  systemSlug: string,
  moduleSlug: string,
): { system: SystemEntry; module: AppEntry } | undefined {
  const system = findSystem(systemSlug);
  const module = system?.apps.find((a) => slug(a.key) === moduleSlug);
  return system && module ? { system, module } : undefined;
}

/** Which system a module belongs to (for links from one module to another). */
export function systemOf(moduleKey: string): SystemEntry | undefined {
  return SYSTEMS.find((s) => s.apps.some((a) => a.key === moduleKey));
}
