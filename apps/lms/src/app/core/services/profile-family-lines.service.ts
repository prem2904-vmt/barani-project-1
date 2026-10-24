import { Injectable, inject } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiService } from './api.service';
import { OptionFamilyService } from './option-family.service';
import type { FamilyNode, OptionFamily } from '../../shared/utils/option-family';

/** One family LINE of a profile (owner 2026-10-23: families live inside
 *  profiles only). The line is a hidden profile-only test (one `family`
 *  parameter) that is a member of exactly this profile. */
export interface ProfileFamilyLine {
  testId: string;
  testCode?: string | null;
  name: string;
  position?: number | null;
  family: OptionFamily;
}

/**
 * `/api/profiles/{profileId}/family-lines[/{testId}]` — list / create /
 * update / delete a profile's family lines. Writes refresh the family cache
 * result entry reads (`OptionFamilyService`).
 */
@Injectable({ providedIn: 'root' })
export class ProfileFamilyLinesService {
  private readonly api = inject(ApiService);
  private readonly families = inject(OptionFamilyService);

  private base(profileId: string) { return `/api/profiles/${encodeURIComponent(profileId)}/family-lines`; }

  list(profileId: string): Observable<ProfileFamilyLine[]> {
    return this.api.get<ProfileFamilyLine[]>(this.base(profileId));
  }

  create(profileId: string, name: string, nodes: FamilyNode[], position?: number): Observable<ProfileFamilyLine> {
    return this.api.post<ProfileFamilyLine>(this.base(profileId),
      position == null ? { name, nodes } : { name, nodes, position }).pipe(tap(() => this.touch()));
  }

  update(profileId: string, testId: string, name: string, nodes: FamilyNode[]): Observable<ProfileFamilyLine> {
    return this.api.put<ProfileFamilyLine>(`${this.base(profileId)}/${encodeURIComponent(testId)}`, { name, nodes })
      .pipe(tap(() => this.touch()));
  }

  remove(profileId: string, testId: string): Observable<unknown> {
    return this.api.delete<unknown>(`${this.base(profileId)}/${encodeURIComponent(testId)}`).pipe(tap(() => this.touch()));
  }

  private touch() { if (this.families.loaded()) this.families.reload().subscribe({ error: () => { /* keep */ } }); }
}
