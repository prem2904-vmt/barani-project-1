/**
 * India OPD medical reference (OPD build) — suggestions only, NOT a hard list.
 * Departments seed the Create-User doctor-details select (admin can also type
 * their own); specialisations seed the free-add tag suggestions. Procedures are
 * fully open (no list). Based on NMC PGMER broad (MD/MS) + super-specialty
 * (DM/MCh) framework and common Indian hospital OPD departments.
 */

/** Structural OPD departments — the managed select's default options. */
export const OPD_DEPARTMENTS: string[] = [
  // Core (MD/MS)
  'General Medicine',
  'General Surgery',
  'Paediatrics',
  'Obstetrics & Gynaecology',
  'Orthopaedics',
  'ENT (Otorhinolaryngology)',
  'Ophthalmology',
  'Dermatology',
  'Psychiatry',
  'Dentistry',
  'Anaesthesiology',
  'Radiodiagnosis',
  // Super-specialty (DM)
  'Cardiology',
  'Neurology',
  'Nephrology',
  'Gastroenterology',
  'Endocrinology',
  'Pulmonology',
  'Medical Oncology',
  'Rheumatology',
  'Clinical Haematology',
  'Neonatology',
  // Super-specialty (MCh)
  'Cardiothoracic Surgery',
  'Neurosurgery',
  'Urology',
  'Plastic & Reconstructive Surgery',
  'Surgical Oncology',
  'Paediatric Surgery',
  'Gastrointestinal Surgery',
  'Vascular Surgery',
];

/** Specialisation suggestions for the free-add tag input (NMC qualifications). */
export const SPECIALIZATION_SUGGESTIONS: string[] = [
  'MD General Medicine', 'MS General Surgery', 'MD Paediatrics',
  'MS/MD Obstetrics & Gynaecology', 'MS Orthopaedics', 'MS ENT',
  'MS Ophthalmology', 'MD Dermatology, Venereology & Leprosy', 'MD Psychiatry',
  'MD Anaesthesiology', 'MD Radiodiagnosis', 'MD Pathology',
  'DM Cardiology', 'DM Neurology', 'DM Nephrology', 'DM Gastroenterology',
  'DM Endocrinology', 'DM Pulmonology', 'DM Medical Oncology', 'DM Rheumatology',
  'MCh Cardiothoracic Surgery', 'MCh Neurosurgery', 'MCh Urology',
  'MCh Plastic Surgery', 'MCh Surgical Oncology', 'MCh Paediatric Surgery',
  'BDS', 'MDS',
];
