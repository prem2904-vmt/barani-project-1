import { lineIssues, lineNodes, newLineDraft, withLineMember, withoutLineMember } from './profile-family-lines';

/** Profile family lines (owner 2026-10-23: families live inside profiles). */
describe('profile family lines — pure rules', () => {
  it('a new line starts as Absent (normal) / Present', () => {
    const d = newLineDraft('Casts');
    expect(d.name).toBe('Casts');
    expect(d.nodes.map(n => [n.code, n.label, n.normal])).toEqual([['ABS', 'Absent', true], ['PRS', 'Present', false]]);
  });

  it('blocks saving without a name, with an empty sub-list or a list amount without choices', () => {
    expect(lineIssues(newLineDraft(''))).toEqual(['Give the family line a name.']);
    expect(lineIssues(newLineDraft('Casts'))).toEqual([]);
    const bad = newLineDraft('Casts');
    bad.nodes[1] = { ...bad.nodes[1], children: { label: 'Cast type', multi: true, nodes: [] } };
    expect(lineIssues(bad)[0]).toContain('sub-list with no options');
    const noChoices = newLineDraft('Casts');
    noChoices.nodes[1] = { ...noChoices.nodes[1], children: { label: 'Cast type', multi: true, nodes: [
      { code: '', label: 'Hyaline', qty: { kind: 'choice', options: [] } }] } };
    expect(lineIssues(noChoices)[0]).toContain('add at least one choice');
    expect(lineIssues(null)).toEqual([]);
  });

  it('sends every labelled node with a stable code (existing codes never change)', () => {
    const d = newLineDraft('Casts');
    d.nodes[1] = { ...d.nodes[1], children: { label: 'Cast type', multi: true, nodes: [
      { code: '', label: 'Hyaline' }, { code: 'GRA', label: 'Granular' }, { code: '', label: 'Hyaline cast' }] } };
    const sent = lineNodes(d);
    expect(sent[1].children!.nodes.map(n => n.code)).toEqual(['HYA', 'GRA', 'HYA2']);
    expect(sent[0].code).toBe('ABS');
  });

  it('the member list follows the server: added at its position (else last), never twice, removed cleanly', () => {
    expect(withLineMember(['a', 'b'], 'f1')).toEqual(['a', 'b', 'f1']);
    expect(withLineMember(['a', 'b'], 'f1', 1)).toEqual(['a', 'f1', 'b']);
    expect(withLineMember(['a', 'f1'], 'f1', 0)).toEqual(['a', 'f1']);
    expect(withLineMember(['a'], 'f1', 9)).toEqual(['a', 'f1']);
    expect(withoutLineMember(['a', 'f1', 'b'], 'f1')).toEqual(['a', 'b']);
  });
});
