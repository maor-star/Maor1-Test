import { describe, expect, it } from 'vitest';
import { companyInputSchema, contactInputSchema, isLocalId, LOCAL_ID_PREFIX } from '@/lib/crm/schemas';

/**
 * What the CRM accepts now that it is the book rather than a copy of one.
 *
 * HubSpot is being wound down, so these rules decide what survives it: a record
 * created here must be identifiable, a category the portal used must not be
 * lost by an edit, and an empty field must mean "not set" rather than the empty
 * string — otherwise a filter on country silently gains a blank bucket.
 */

describe('company input', () => {
  it('needs a name and nothing else', () => {
    const parsed = companyInputSchema.parse({ name: 'Markito' });
    expect(parsed.name).toBe('Markito');
    expect(parsed.domain ?? null).toBeNull();
  });

  it('rejects a company with no name', () => {
    const result = companyInputSchema.safeParse({ name: '   ' });
    expect(result.success).toBe(false);
    const message = result.success ? '' : result.error.issues[0]?.message;
    expect(message).toBe('A company needs a name');
  });

  it('turns every empty field into null rather than an empty string', () => {
    const parsed = companyInputSchema.parse({
      name: 'Markito',
      domain: '',
      lifecycleStage: '',
      country: '',
      industry: '',
      notes: '',
    });
    expect(parsed.domain).toBeNull();
    expect(parsed.lifecycleStage).toBeNull();
    expect(parsed.country).toBeNull();
    expect(parsed.industry).toBeNull();
    expect(parsed.notes).toBeNull();
  });

  it('keeps a lifecycle stage the standard list does not contain', () => {
    // HubSpot portals define their own stages. Dropping one on edit would
    // quietly recategorise a record.
    const parsed = companyInputSchema.parse({ name: 'Markito', lifecycleStage: 'reseller_tier2' });
    expect(parsed.lifecycleStage).toBe('reseller_tier2');
  });

  it('trims what it stores', () => {
    expect(companyInputSchema.parse({ name: '  Markito  ' }).name).toBe('Markito');
  });
});

describe('contact input', () => {
  it('accepts a contact with only an email', () => {
    expect(contactInputSchema.safeParse({ email: 'ravit@example.com' }).success).toBe(true);
  });

  it('accepts a contact with only a name', () => {
    expect(contactInputSchema.safeParse({ firstName: 'Ravit' }).success).toBe(true);
  });

  it('rejects a contact that is neither named nor addressable', () => {
    const result = contactInputSchema.safeParse({ jobTitle: 'Head of Sales' });
    expect(result.success).toBe(false);
    const message = result.success ? '' : result.error.issues[0]?.message;
    expect(message).toBe('A contact needs a name or an email');
  });

  it('rejects an address that is not one', () => {
    const result = contactInputSchema.safeParse({ firstName: 'Ravit', email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('treats a blank email as absent, not as invalid', () => {
    const parsed = contactInputSchema.parse({ firstName: 'Ravit', email: '' });
    expect(parsed.email).toBeNull();
  });
});

describe('local ids', () => {
  it('marks records created here, so a sync can never match them', () => {
    expect(isLocalId(`${LOCAL_ID_PREFIX}9d1f`)).toBe(true);
    // A HubSpot id is numeric — the two can never collide.
    expect(isLocalId('12345678901')).toBe(false);
  });
});
