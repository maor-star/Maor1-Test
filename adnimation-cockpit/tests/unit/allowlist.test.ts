import { describe, expect, it } from 'vitest';
import { isAllowedEmail, parseAllowedEmails, roleForEmail } from '@/lib/auth/allowlist';

const LIST = 'maor@adnimation.com,mor@adnimation.com';

describe('parseAllowedEmails', () => {
  it('trims, lowercases and drops empties', () => {
    expect(parseAllowedEmails(' Maor@Adnimation.com , ,mor@adnimation.com ')).toEqual([
      'maor@adnimation.com',
      'mor@adnimation.com',
    ]);
  });

  it('returns an empty list when unset', () => {
    expect(parseAllowedEmails(undefined)).toEqual([]);
  });
});

describe('isAllowedEmail', () => {
  it('admits the two configured addresses', () => {
    expect(isAllowedEmail('maor@adnimation.com', LIST)).toBe(true);
    expect(isAllowedEmail('mor@adnimation.com', LIST)).toBe(true);
  });

  it('is case and whitespace insensitive', () => {
    expect(isAllowedEmail('  MAOR@Adnimation.COM ', LIST)).toBe(true);
  });

  it('rejects anyone else, including the same domain', () => {
    expect(isAllowedEmail('someone@adnimation.com', LIST)).toBe(false);
    expect(isAllowedEmail('attacker@evil.com', LIST)).toBe(false);
  });

  it('rejects a missing email', () => {
    expect(isAllowedEmail(null, LIST)).toBe(false);
    expect(isAllowedEmail(undefined, LIST)).toBe(false);
    expect(isAllowedEmail('', LIST)).toBe(false);
  });

  it('locks everyone out when the allowlist is unset — fails closed', () => {
    expect(isAllowedEmail('maor@adnimation.com', undefined)).toBe(false);
    expect(isAllowedEmail('maor@adnimation.com', '')).toBe(false);
    expect(isAllowedEmail('maor@adnimation.com', '  ,  ')).toBe(false);
  });

  it('does not admit a lookalike address', () => {
    expect(isAllowedEmail('maor@adnimation.com.evil.com', LIST)).toBe(false);
    expect(isAllowedEmail('xmaor@adnimation.com', LIST)).toBe(false);
  });
});

describe('roleForEmail', () => {
  it('makes the first address the owner and the second the operator', () => {
    expect(roleForEmail('maor@adnimation.com', LIST)).toBe('owner');
    expect(roleForEmail('mor@adnimation.com', LIST)).toBe('operator');
  });

  it('returns null for an address outside the list', () => {
    expect(roleForEmail('nobody@adnimation.com', LIST)).toBeNull();
  });
});
