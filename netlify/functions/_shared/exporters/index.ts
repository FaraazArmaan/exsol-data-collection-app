import { format as csv } from './csv';
import { format as xlsx } from './xlsx';
import { format as meta } from './meta';
import { format as whatsapp } from './whatsapp';
import { format as amazon } from './amazon';
import { format as flipkart } from './flipkart';
import type { ExporterContext, ExportResult } from './types';

export type ExportPlatform =
  | 'csv' | 'xlsx' | 'meta' | 'whatsapp' | 'amazon' | 'flipkart';

export const exporters: Record<ExportPlatform, (ctx: ExporterContext) => ExportResult> = {
  csv,
  xlsx,
  meta,
  whatsapp,
  amazon,
  flipkart,
};

export type { ExporterContext, ExportResult } from './types';
