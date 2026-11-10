/**
 * The ENT nose sample (synthetic patient), copied from the API fixture
 * prefrontal-prepare-mw `Prepare.Tests/Fixtures/forms/ent-nose/` so the
 * filler is tested against the same form the narrative goldens use.
 */
import form from './ent-nose.form.json';
import answers from './ent-nose.answers.json';
import { Answers, FormDefinition } from '../core/types';

export const ENT_SAMPLE = form as unknown as FormDefinition;
export const ENT_ANSWERS = answers as Answers;
