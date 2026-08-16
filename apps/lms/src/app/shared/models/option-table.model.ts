/** One row of a shared dropdown dictionary (Result Option Master table). */
export interface OptionRow {
  code?: string | null;
  value: string;
  sortOrder?: number;
  /** Drives abnormal flagging: picking a non-normal option is treated like an
   *  out-of-range numeric (highlighted at entry, bold ▲ on the report). */
  normal?: boolean;
  active?: boolean;
}

/** A shared dropdown dictionary owned by the tenant, homed on a department
 *  page. Every test parameter whose `optionTable` names this table's code
 *  renders its dropdown from here — edit once, all of them update. */
export interface OptionTable {
  id: string;
  code: string;
  name: string;
  departmentId?: string | null;
  isActive: boolean;
  options: OptionRow[];
  updatedAt?: string;
}
