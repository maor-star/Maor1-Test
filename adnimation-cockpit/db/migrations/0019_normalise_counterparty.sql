-- One spelling of a counterparty, so duplicates can be recognised.
--
-- "Altshul" and "Altshul Ltd" are one company, and the intake sees whichever
-- spelling the sender happened to use. This lives in the database rather than
-- in the app or the job because both need it and they must never disagree —
-- a rule that recognises a duplicate in one place and not the other is worse
-- than no rule.
--
-- Deliberately conservative: it strips punctuation and legal suffixes only.
-- Stripping industry words like "media" or "ads" would fold genuinely
-- different companies together, and merging two real counterparties is far
-- more expensive than leaving two rows for one.
create or replace function normalise_counterparty(name text)
returns text
language sql
immutable
as $fn$
  select nullif(
    trim(
      -- Collapse repeated spaces last, so removing punctuation cannot leave a
      -- double space and two spellings of one name normalise differently.
      regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(coalesce(name, '')),
          -- Legal form, with or without punctuation, at the end only.
          '[\s,\.]+(ltd|limited|inc|incorporated|llc|l\.l\.c|corp|corporation|co|company|gmbh|b\.?v|s\.?a|s\.?r\.?l|plc|pte|ag|oy|ab)\.?$',
          '',
          'g'
        ),
        -- Everything that is not a letter, a digit or a space.
        '[^a-z0-9֐-׿ ]+',
        '',
        'g'
      ),
      ' {2,}', ' ', 'g')
    ),
    ''
  );
$fn$;
