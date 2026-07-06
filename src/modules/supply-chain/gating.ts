import type { SectionKey } from './types';

const SECTION_MODULE: Record<SectionKey, string> = {
  inventory: 'inventory',
  procurement: 'procurement',
  manufacturing: 'manufacturing',
};

const ORDER: SectionKey[] = ['inventory', 'procurement', 'manufacturing'];

// A section shows only when its backing module is enabled for the client.
export function visibleSectionsFor(enabledModuleKeys: Set<string>): SectionKey[] {
  return ORDER.filter((k) => enabledModuleKeys.has(SECTION_MODULE[k]));
}
