import type { SettingsArea, SettingsLevel } from '../utils/settings-access';

/** One area of one person (prefrontal-mw `SettingsAccessAreaView`, GET/PUT /api/settings-access/users/{id}). */
export interface SettingsAccessAreaView {
  area: SettingsArea;
  /** The stored grant (what the pf-select shows). */
  grant: SettingsLevel;
  /** What the job role(s) already give in this area. */
  fromRole: SettingsLevel;
  /** Role + grants: what the person really has. */
  effective: SettingsLevel;
  /** May the caller change this area for this person. */
  canChange: boolean;
  /** The levels the caller may pick here. */
  choices: SettingsLevel[];
}

export interface SettingsAccessView {
  userId: string;
  areas: SettingsAccessAreaView[];
}
