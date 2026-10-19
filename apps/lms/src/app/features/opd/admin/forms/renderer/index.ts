/**
 * Public API of the OPD consult-form renderer (Agent A → Agent C).
 *
 *   import { OpdFormRendererComponent, normalizeSchema, missingRequired } from '../admin/forms/renderer';
 *
 *   <pf-opd-form-renderer
 *       [schema]="version.schema"          // OpdFormDoc (schema v2) or a foundation v1 schema
 *       [answers]="answers()"              // OpdAnswers: { [questionKey]: value | { r, l } }
 *       [addons]="resolved.addons"         // the doctor's add-only questions (optional)
 *       mode="edit"                        // 'edit' | 'readonly' | 'print' | 'design'
 *       layout="screen"                    // 'screen' (2 columns) | 'phone' (1 column)
 *       (answersChange)="answers.set($event)"
 *       (mediaRequest)="capture($event)">  // { key, side? } — host uploads, then adds OpdMediaRef(s)
 *   </pf-opd-form-renderer>
 *
 * Which form: GET /api/opd/admin/forms/resolve?serviceId=&departmentId=&doctorUserId=
 *   → { formId, formName, source, version: { id, version, schema }, addons }.
 * Store `version.id` on the consult (opd_consult_records.FormVersionId) and render a
 * past consult with GET /api/opd/admin/forms/versions/{versionId} (immutable).
 */
export { OpdFormRendererComponent } from './opd-form-renderer.component';
export type { OpdFormRenderMode, OpdMediaRequest } from './opd-form-renderer.component';
export {
  normalizeSchema, allQuestions, visibleQuestions, conditionMet, missingRequired, isAnswered, answerText, printRows,
  sampleAnswers, YES_NO, BUILT_INS,
} from '../form-schema';
export type {
  OpdFormDoc, OpdFormDocSection, OpdQuestion, OpdQType, OpdAnswers, OpdSided, OpdMediaRef, OpdMark, OpdCondition, PrintRow, Side,
} from '../form-schema';
