/** Spec fixtures for the workflow editor (excluded from the app build: *.spec-helpers.ts). */
/** The shipped Standard flow (prefrontal-mw ProcessWorkflowSeeder) — what most labs run. */
const cat = (id: string, name: string, order: number, roles: string[] = []) => ({ id, name, icon: 'folder', color: '#f59e0b', order, roles });
const act = (id: string, type: string, categoryId: string, enabled = true, order = 0) => ({ id, type, categoryId, enabled, order });
export const STANDARD = {
  categories: [
    cat('frontdesk', 'Frontdesk', 0, ['Receptionist', 'Branch Manager', 'Lab Admin']),
    cat('homecoll', 'Home Visits', 1, ['Home Collection Agent', 'Sample Collector', 'Receptionist']),
    cat('lab', 'Lab', 2, ['Lab Technician', 'Lab Admin']),
    cat('validate', 'Validate', 3, ['Pathologist', 'Lab Admin']),
    cat('results', 'Results', 4, ['Receptionist', 'Branch Manager', 'Lab Admin']),
    cat('messages', 'Messages', 5, []),
  ],
  actions: [
    act('a1', 'appointment', 'frontdesk', true, 0), act('a2', 'patient_registration', 'frontdesk', true, 1),
    act('a3', 'walk_in_order', 'frontdesk', true, 2), act('a4', 'billing', 'frontdesk', true, 3),
    act('a5', 'sample_collection', 'frontdesk', true, 4), act('a6', 'queue', 'frontdesk', true, 5),
    act('a7', 'dispatch', 'frontdesk', true, 6), act('a8', 'home_visits', 'homecoll'),
    act('a9', 'lab_intake', 'lab', true, 0), act('a10', 'result_entry', 'lab', true, 1),
    act('a11', 'validate', 'validate'), act('a12', 'results', 'results'), act('a13', 'messages', 'messages'),
  ],
};
