/** Referring network fixtures (fake) shared by the grid + Front desk screens specs. */
export const HOSPITALS = [
  { id: 'h1', name: 'Apollo Hospitals', code: 'APO', address: 'Greams Road, Chennai', phone: '+91 44 2829 0200', email: null, gstin: '33AABCA1234A1Z5', notes: null, isActive: true, doctorCount: 4 },
  { id: 'h2', name: 'Kauvery', code: 'KAU', address: 'Alwarpet, Chennai', phone: '+91 44 4000 6000', email: null, gstin: null, notes: null, isActive: true, doctorCount: 12 },
  { id: 'h3', name: 'MGM Healthcare', code: null, address: 'Aminjikarai', phone: null, email: null, gstin: null, notes: null, isActive: false, doctorCount: 0 },
];
const doc = (id: string, name: string, q: string, hs: string[], dept: string, phone: string | null, active = true) => ({
  id, name, qualification: q, department: dept, phone, isActive: active, email: null, designation: null, registrationNo: null,
  hospitalId: hs[0] ?? null, hospitals: hs.map(h => ({ id: h, name: HOSPITALS.find(x => x.id === h)!.name })),
});
export const DOCTORS = [
  doc('dr1', 'Dr. Priya Krishnan', 'MBBS, MD', ['h1'], 'Cardiology', '9840012345'),
  doc('dr2', 'Dr. Arun Raman', 'MBBS', ['h1', 'h2'], 'General Medicine', '9840099999'),
  doc('dr3', 'dr. bala murugan', 'MS', [], 'Surgery', null),
  doc('dr4', 'Dr. Zara Thomas', 'DGO', ['h2'], 'Obstetrics', '9876500000', false),
  doc('dr5', 'Dr. Meena S', 'MBBS, DNB', ['h2'], 'Paediatrics', '9876543210'),
];
