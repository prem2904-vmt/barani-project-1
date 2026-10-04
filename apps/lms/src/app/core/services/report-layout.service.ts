import type { ReportSignature } from '../../shared/models/report.model';
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
import { AgeSource, bandAgeYears } from '../../shared/utils/patient-age';
import { ApiError } from '../../shared/models/api-response.model';

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

  /** Profile one-page layout — "Restore to default": pulls ONLY the
   *  `page_layout` section from the master catalogue's matching test
   *  (by CatalogKey) into this test's own sections. `no_default` (e.g. a
   *  non-CBC profile) resolves to `null` rather than throwing — the caller
   *  shows "no default available" instead of an error toast. */
  /** Instrument codes actually attached to recent results of this profile's
   *  tests (tenant-scoped, server-side) — for the designer's analyzer-slot
   *  palette. Never throws: an unreachable/failed call resolves to an empty
   *  list, same as "nothing seen yet" (the caller falls back to the known
   *  M51 suggestions either way). */
  async analyzerCodesSeen(testId: string): Promise<string[]> {
    try {
      const res = await firstValueFrom(this.api.get<{ testId: string; codes: string[] }>(
        `/api/report-layout/test/${testId}/analyzer-codes`
      ));
      return res?.codes ?? [];
    } catch {
      return [];
    }
  }

  /** Profile one-page layout palette: the analyzer image types this
   *  profile can show — every image code an instrument LINKED to the
   *  profile's members (code map → member CatalogKey) has sent, plus any
   *  already attached to its results. Never throws: failure = nothing
   *  linked (the designer then offers CBC suggestions / manual codes). */
  async analyzerImages(testId: string): Promise<ProfileAnalyzerImages> {
    try {
      const res = await firstValueFrom(this.api.get<ProfileAnalyzerImages>(
        `/api/report-layout/test/${testId}/analyzer-images`
      ));
      return { linked: !!res?.linked, mapped: !!res?.mapped, instruments: res?.instruments ?? [], images: res?.images ?? [] };
    } catch {
      return { linked: false, instruments: [], images: [] };
    }
  }

  /** A department's sign-off AS THE REPORT PRINTS IT (configured
   *  signatories, their designations, reg. nos and signature images — the
   *  signed-in user standing in for "whoever tests / validates"). Null when
   *  unavailable — the sample report then keeps its generic sign-off. */
  async signoffPreview(departmentId: string): Promise<{ department: string | null; signatures: ReportSignature[] } | null> {
    try {
      return await firstValueFrom(this.api.get<{ department: string | null; signatures: ReportSignature[] }>(
        `/api/report-layout/department/${departmentId}/signoff-preview`));
    } catch {
      return null;
    }
  }

  async restorePageLayoutDefault(testId: string): Promise<{ sections: ReportSection[] } | null> {
    try {
      return await firstValueFrom(this.api.post<{ sections: ReportSection[] }>(
        `/api/report-layout/test/${testId}/page-layout/restore-default`, {}
      ));
    } catch (e) {
      if (ApiError.from(e).code === 'no_default') return null;
      throw e;
    }
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
    patient?: { sex?: string | null } & AgeSource,
    parametersJson?: string | null,
    profileCode?: string | null,
  ): Promise<ResolvedReportLayout> {
    // Pass the patient's sex/age so the engine picks the matching reference range
    // (male/female/age-specific) instead of always the first one. The age is
    // the DOB-derived FRACTIONAL band age (shared helper), so an infant's
    // newborn / infant bands resolve — a whole-years 0 never could.
    // profileCode (H2, 2026-10-02): the nearest enclosing profile this test
    // was ordered under — a profile-tagged band (Gestational OGTT's <92)
    // only ever applies when this is set to that profile's own code.
    return firstValueFrom(this.api.post<ResolvedReportLayout>(
      `/api/report-layout/preview/${testId}`,
      { values, imageUrls, sex: patient?.sex ?? null, age: bandAgeYears(patient), parametersJson: parametersJson ?? null, profileCode: profileCode ?? null },
    ));
  }
}

/** GET /api/report-layout/test/{id}/analyzer-images — codes/labels only,
 *  never image bytes or patient data. */
export interface ProfileAnalyzerImages {
  linked: boolean;
  /** True = these are the graphs MAPPED to this profile (Instruments → Code
   *  mapping); false = discovered from linked instruments' runs (fallback). */
  mapped?: boolean;
  instruments: Array<{ id: string; name: string; make?: string | null; model?: string | null }>;
  images: Array<{ code: string; label?: string | null; seen: number; instrumentIds?: string[] }>;
}
