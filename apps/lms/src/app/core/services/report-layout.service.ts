import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import {
  DepartmentReportColumnsResponse,
  ParameterColumnLocks,
  ReportColumn,
  ReportSection,
  ResolvedReportLayout,
  TestReportLayoutResponse,
} from '../../shared/models/report-layout.model';

/**
 * HTTP wrapper around ReportLayoutController. ApiService already unwraps
 * the `ApiResponse<T>` envelope so callers see the bare payload here.
 */
@Injectable({ providedIn: 'root' })
export class ReportLayoutService {
  private readonly api = inject(ApiService);

  // ── Department columns ──────────────────────────────────

  getDeptColumns(departmentId: string): Promise<DepartmentReportColumnsResponse> {
    return firstValueFrom(this.api.get<DepartmentReportColumnsResponse>(
      `/api/report-layout/department/${departmentId}`
    ));
  }

  saveDeptColumns(departmentId: string, columns: ReportColumn[]): Promise<unknown> {
    return firstValueFrom(this.api.post<unknown>(
      `/api/report-layout/department/${departmentId}`, { columns }
    ));
  }

  // ── Per-test layout ─────────────────────────────────────

  getTestLayout(testId: string): Promise<TestReportLayoutResponse> {
    return firstValueFrom(this.api.get<TestReportLayoutResponse>(
      `/api/report-layout/test/${testId}`
    ));
  }

  saveTestLayout(testId: string, sections: ReportSection[]): Promise<unknown> {
    return firstValueFrom(this.api.post<unknown>(
      `/api/report-layout/test/${testId}`, { sections }
    ));
  }

  // ── Per-(test, parameter) locks ─────────────────────────

  listLocks(testId: string): Promise<ParameterColumnLocks[]> {
    return firstValueFrom(this.api.get<ParameterColumnLocks[]>(
      `/api/report-layout/test/${testId}/locks`
    ));
  }

  saveLock(testId: string, parameterName: string, columnLocks: ParameterColumnLocks['columnLocks']): Promise<unknown> {
    return firstValueFrom(this.api.post<unknown>(
      `/api/report-layout/test/${testId}/locks`, { parameterName, columnLocks }
    ));
  }

  deleteLock(testId: string, parameterName: string): Promise<unknown> {
    return firstValueFrom(this.api.delete<unknown>(
      `/api/report-layout/test/${testId}/locks/${encodeURIComponent(parameterName)}`
    ));
  }

  // ── Per-test column override ────────────────────────────

  /** The test/profile's OWN column override, or columns:null when it
   *  inherits the department set. */
  getTestColumns(testId: string): Promise<{ testId: string; columns: ReportColumn[] | null; configured: boolean }> {
    return firstValueFrom(this.api.get<{ testId: string; columns: ReportColumn[] | null; configured: boolean }>(
      `/api/report-layout/test/${testId}/columns`
    ));
  }

  /** Save the override; null (or empty) reverts to the department columns. */
  saveTestColumns(testId: string, columns: ReportColumn[] | null): Promise<unknown> {
    return firstValueFrom(this.api.post<unknown>(
      `/api/report-layout/test/${testId}/columns`,
      { columns },
    ));
  }

  // ── Preview ─────────────────────────────────────────────

  /** Run the engine end-to-end. Used by the admin live preview AND the
   *  patient-facing report viewer + PDF generator with real result values. */
  preview(
    testId: string,
    values: Record<string, unknown>,
    imageUrls: string[] = [],
    patient?: { sex?: string | null; age?: number | null },
  ): Promise<ResolvedReportLayout> {
    // Pass the patient's sex/age so the engine picks the matching reference range
    // (male/female/age-specific) instead of always the first one.
    return firstValueFrom(this.api.post<ResolvedReportLayout>(
      `/api/report-layout/preview/${testId}`,
      { values, imageUrls, sex: patient?.sex ?? null, age: patient?.age ?? null },
    ));
  }
}
