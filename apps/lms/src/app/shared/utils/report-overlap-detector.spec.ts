import { jsPDF } from 'jspdf';
import { buildReportPdf } from './report-pdf';
import { describeOverlap, findOverlaps, recordDrawing } from './report-overlap-detector';
import { silenceJsdomCanvas } from './report-header-legacy.spec-helpers';
import { classicBodyMatrix, richInput } from './report-theme.spec-helpers';

describe('overlap detector', () => {
  silenceJsdomCanvas();
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T05:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('finds a planted overlap (two texts on top of each other) and names it', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const rec = recordDrawing(doc);
    doc.setFontSize(12);
    doc.text('Lakshminarasimhan Venkatasubramanian', 40, 100);
    doc.text('Specimen(s) :', 120, 101);               // starts inside the name's box
    doc.text('Far below', 40, 300);
    const found = findOverlaps(rec.boxes);
    expect(found).toHaveLength(1);
    expect(describeOverlap(found[0])).toContain('runs into');
    expect(found[0].dx).toBeGreaterThan(50);
    rec.stop();
  });

  it('text that sits side by side or stacked on a normal line step is not an overlap', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const rec = recordDrawing(doc);
    doc.setFontSize(10);
    const w = doc.getTextWidth('Age : ');
    doc.text('Age : ', 40, 100);
    doc.text('45 Years', 40 + w, 100);
    doc.text('Sex : Male', 40, 112);
    doc.text(['line one', 'line two', 'line three'], 40, 200);
    expect(findOverlaps(rec.boxes)).toEqual([]);
    rec.stop();
  });

  it('an image over text overlaps; a page-sized background and a rotated watermark are ignored', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const rec = recordDrawing(doc);
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    doc.setFontSize(10);
    doc.text('Caption', 50, 110);
    doc.addImage(png, 'PNG', 40, 90, 80, 30);
    doc.addImage(png, 'PNG', 0, 0, 595, 842);          // background wash
    doc.setFontSize(60);
    doc.text('SAMPLE', 100, 400, { angle: 45 });       // watermark
    const found = findOverlaps(rec.boxes);
    expect(found).toHaveLength(1);
    expect(found[0].b.kind === 'image' || found[0].a.kind === 'image').toBe(true);
    rec.stop();
  });

  it('boxes on different pages never overlap', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const rec = recordDrawing(doc);
    doc.setFontSize(10);
    doc.text('Same place', 40, 100);
    doc.addPage();
    doc.text('Same place', 40, 100);
    expect(findOverlaps(rec.boxes)).toEqual([]);
  });

  it('stop() restores the document and the recorder never changes the PDF bytes', () => {
    const plain = buildReportPdf(richInput());
    let rec: ReturnType<typeof recordDrawing> | null = null;
    const watched = buildReportPdf({ ...richInput(), drawRecorder: d => { rec = recordDrawing(d); } });
    const bytes = (d: jsPDF) => Buffer.from(d.output('arraybuffer')).toString('latin1').replace(/\/CreationDate \([^)]*\)/g, '').replace(/\/ID \[[^\]]*\]/g, '');
    expect(bytes(watched)).toBe(bytes(plain));
    expect(rec!.boxes.length).toBeGreaterThan(100);
  });

  const overlapsOf = (patch: Parameters<typeof richInput>[0]) => {
    let rec: ReturnType<typeof recordDrawing> | null = null;
    buildReportPdf({ ...richInput(patch), drawRecorder: d => { rec = recordDrawing(d); } });
    return findOverlaps(rec!.boxes).map(describeOverlap);
  };

  it('today\'s rich report prints clean in the three stock patient layouts', () => {
    for (const [name, patch] of classicBodyMatrix().filter(([n]) => ['three-col', 'four-col', 'stacked'].includes(n))) {
      expect(overlapsOf(patch), name).toEqual([]);
    }
  });

  it('…and finds the one real overlap already on paper: the arranged-columns strip, 30-character name into the Specimen column', () => {
    const columns = classicBodyMatrix().find(([n]) => n === 'columns')![1];
    expect(overlapsOf(columns).every(d => d.includes('Lakshmi Narayanan Venkataraman') && d.includes('Specimen(s)'))).toBe(true);
    expect(overlapsOf(columns).length).toBeGreaterThan(0);
  });
});
