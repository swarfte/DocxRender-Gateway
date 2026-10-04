import type { Env } from './config';

export interface UploadedFiles {
  data: File;
  templater: File;
}

export interface AppVariables {
  requestId: string;
  startedAt: number;
  uploadSizes?: { templateSizeBytes?: number; dataSizeBytes?: number };
  renderDurationMs?: number;
}

export type AppEnv = {
  Bindings: Env;
  Variables: AppVariables;
};
