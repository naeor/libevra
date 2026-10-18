import {
  importJobStatusSchema,
  type ImportJobRequest,
  type ImportJobStatus,
} from "@libellum/shared";

import { apiFetch } from "../api.js";

/**
 * D5 服务端分批任务。进度只来自这个接口；页面不自行推算“完成了几笔”。
 */
export async function createImportJob(request: ImportJobRequest): Promise<ImportJobStatus> {
  const raw = await apiFetch<unknown>("/ledger-imports/jobs", {
    method: "POST",
    body: request,
    timeoutMs: 120_000,
  });
  return importJobStatusSchema.parse(raw);
}

export async function getImportJob(jobId: string): Promise<ImportJobStatus> {
  const raw = await apiFetch<unknown>(`/ledger-imports/jobs/${jobId}`, { timeoutMs: 15_000 });
  return importJobStatusSchema.parse(raw);
}

export async function resumeImportJob(jobId: string): Promise<ImportJobStatus> {
  const raw = await apiFetch<unknown>(`/ledger-imports/jobs/${jobId}/resume`, {
    method: "POST",
    timeoutMs: 15_000,
  });
  return importJobStatusSchema.parse(raw);
}
