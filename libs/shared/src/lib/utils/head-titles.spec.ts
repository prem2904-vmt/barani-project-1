import { fillHeadTitles, headTitleOf } from './head-titles';

/** Card heads (owner 2026-11-21): a narrow head shows its actions as icons — each keeps a tooltip. */
describe('fillHeadTitles', () => {
  const head = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

  it('titles a button from its aria-label, else its words', () => {
    const d = head('<button aria-label="Cancel new branch">Cancel</button><button> <svg></svg> Add  branch </button>');
    expect(fillHeadTitles(d)).toBe(2);
    const [a, b] = Array.from(d.querySelectorAll('button'));
    expect(a.getAttribute('title')).toBe('Cancel new branch');
    expect(b.getAttribute('title')).toBe('Add branch');
  });

  it("never replaces a screen's own title, skips positioned tips and empty buttons", () => {
    const d = head('<button title="Mine">Add</button><button data-tip="Tip">X</button><button></button>');
    expect(fillHeadTitles(d)).toBe(0);
    expect(d.querySelector('button')!.getAttribute('title')).toBe('Mine');
    expect(d.querySelectorAll('[title]').length).toBe(1);
  });

  it('keeps its own title in step when the words change (Add hospital → Add doctor)', () => {
    const d = head('<button>Add hospital</button>');
    fillHeadTitles(d);
    const b = d.querySelector('button')!;
    b.textContent = 'Add doctor';
    expect(fillHeadTitles(d)).toBe(1);
    expect(b.getAttribute('title')).toBe('Add doctor');
    expect(fillHeadTitles(d)).toBe(0);
  });

  it('tolerates a missing root', () => {
    expect(fillHeadTitles(null)).toBe(0);
    expect(headTitleOf(head('<a href="#"> Open </a>').querySelector('a')!)).toBe('Open');
  });
});
