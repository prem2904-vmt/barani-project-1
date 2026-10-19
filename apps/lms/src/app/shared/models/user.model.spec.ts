import { userDisplayName } from './user.model';

describe('userDisplayName', () => {
  it('returns empty string when input is null or undefined', () => {
    expect(userDisplayName(null)).toBe('');
    expect(userDisplayName(undefined)).toBe('');
  });

  it('prefers the server displayName when present', () => {
    const user = {
      firstName: 'John',
      fathersName: 'Smith',
      displayName: 'Dr. John Smith',
      title: 'Dr.'
    };
    expect(userDisplayName(user)).toBe('Dr. John Smith');
  });

  it('returns just firstName when no displayName and no title or fathersName', () => {
    const user = {
      firstName: 'Alice',
      fathersName: ''
    };
    expect(userDisplayName(user)).toBe('Alice');
  });

  it('combines firstName and fathersName when no displayName', () => {
    const user = {
      firstName: 'Bob',
      fathersName: 'Johnson'
    };
    expect(userDisplayName(user)).toBe('Bob Johnson');
  });

  it('combines title and firstName when no displayName or fathersName', () => {
    const user = {
      firstName: 'Carol',
      fathersName: '',
      title: 'Ms.'
    };
    expect(userDisplayName(user)).toBe('Ms. Carol');
  });

  it('combines all three: title, firstName, and fathersName when no displayName', () => {
    const user = {
      firstName: 'David',
      fathersName: 'Williams',
      title: 'Mr.'
    };
    expect(userDisplayName(user)).toBe('Mr. David Williams');
  });

  it('filters out null title values from the fallback assembly', () => {
    const user = {
      firstName: 'Eve',
      fathersName: '',
      title: null
    };
    expect(userDisplayName(user)).toBe('Eve');
  });

  it('filters out empty strings from the fallback assembly', () => {
    const user = {
      firstName: 'Frank',
      fathersName: '',
      title: ''
    };
    expect(userDisplayName(user)).toBe('Frank');
  });

  it('handles title as null and builds fallback correctly', () => {
    const user = {
      firstName: 'Grace',
      fathersName: 'Brown',
      title: null
    };
    expect(userDisplayName(user)).toBe('Grace Brown');
  });

  it('returns empty string when all components are empty, null, or undefined', () => {
    const user = {
      firstName: '',
      fathersName: '',
      title: null
    };
    expect(userDisplayName(user)).toBe('');
  });

  it('uses displayName as empty string (falsy) and falls back to assembly', () => {
    const user = {
      firstName: 'Henry',
      fathersName: 'Davis',
      displayName: '',
      title: 'Dr.'
    };
    expect(userDisplayName(user)).toBe('Dr. Henry Davis');
  });

  it('handles pick type with firstName, fathersName, and displayName', () => {
    const user = {
      firstName: 'Iris',
      fathersName: 'Chen',
      displayName: 'Iris Chen'
    };
    expect(userDisplayName(user)).toBe('Iris Chen');
  });

  it('does not double-up titles when server displayName already includes it', () => {
    // The function prefers displayName (which already has title) and only uses
    // the title fallback when displayName is absent. This verifies the comment.
    const user = {
      firstName: 'Jack',
      fathersName: 'Miller',
      displayName: 'Dr. Jack Miller',
      title: 'Dr.' // Ignored since displayName is present
    };
    expect(userDisplayName(user)).toBe('Dr. Jack Miller');
    // Not 'Dr. Dr. Jack Miller'
  });
});
