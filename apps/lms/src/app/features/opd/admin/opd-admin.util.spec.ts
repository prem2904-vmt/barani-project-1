import { daysText, deptCode, followUpText, inr, libraryVersion, nextServiceCode, priceText } from './opd-admin.util';

describe('OPD Master helpers', () => {
  it('prices are just the price (₹, Indian grouping)', () => {
    expect(inr(1500)).toBe('₹1,500');
    expect(inr(0)).toBe('₹0');
    expect(inr(99.5)).toBe('₹99.5');
  });

  it('price cell: common price, or the per-doctor range of ACTIVE rows', () => {
    expect(priceText({ priceMode: 'common', commonPrice: 500, doctorPrices: [] })).toBe('₹500');
    expect(priceText({ priceMode: 'per_doctor', commonPrice: 0, doctorPrices: [
      { doctorUserId: 'a', price: 600, isActive: true }, { doctorUserId: 'b', price: 800, isActive: true },
      { doctorUserId: 'c', price: 1000, isActive: false },
    ] })).toBe('₹600 – ₹800');
    expect(priceText({ priceMode: 'per_doctor', commonPrice: 0, doctorPrices: [{ doctorUserId: 'a', price: 600, isActive: true }] })).toBe('₹600');
    expect(priceText({ priceMode: 'per_doctor', commonPrice: 0, doctorPrices: [] })).toBe('Set per doctor');
  });

  it('follow-up rule in words', () => {
    expect(followUpText(7, 250)).toBe('Within 7 days · ₹250');
    expect(followUpText(1, null)).toBe('Within 1 day · free');
    expect(followUpText(null, 250)).toBe('—');
  });

  it('department codes from names, unique', () => {
    expect(deptCode('General Medicine', [])).toBe('GM');
    expect(deptCode('ENT', [])).toBe('ENT');
    expect(deptCode('Dermatology', [])).toBe('DERM');
    expect(deptCode('General Medicine', ['GM'])).toBe('GM2');
  });

  it('next free service code per department and category', () => {
    expect(nextServiceCode('ENT', 'consultation', ['ENT-C01'])).toBe('ENT-C02');
    expect(nextServiceCode('ENT', 'procedure', ['ENT-C01'])).toBe('ENT-P01');
  });

  it('availability days read as a range or a list', () => {
    expect(daysText(['mon', 'tue', 'wed', 'thu', 'fri', 'sat'])).toBe('Mon–Sat');
    expect(daysText(['fri', 'mon', 'wed'])).toBe('Mon, Wed, Fri');
    expect(daysText([])).toBe('—');
  });

  it('library version label', () => {
    expect(libraryVersion({ publishedVersion: null, draftVersion: 1 })).toBe('New · draft');
    expect(libraryVersion({ publishedVersion: 3, draftVersion: 4 })).toBe('v3 · draft changes');
    expect(libraryVersion({ publishedVersion: 2, draftVersion: null })).toBe('v2');
  });
});
