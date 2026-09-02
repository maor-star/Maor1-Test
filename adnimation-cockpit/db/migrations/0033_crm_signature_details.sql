-- Everything a signature gives, kept.
--
-- The harvest read a name, a title, a phone and a company and threw the rest
-- away — the mobile beside the office line, the LinkedIn URL, the site, the
-- address under it all. Those are the fields he reaches for before picking up
-- the phone, and they were sitting in the mail the whole time.
--
-- signature holds the block itself. A parser is a guess; the lines the person
-- wrote are the fact, and keeping them means a field this code does not know
-- how to read yet is still there to read later.

alter table crm_contacts add column if not exists mobile        text;
alter table crm_contacts add column if not exists linkedin_url  text;
alter table crm_contacts add column if not exists website       text;
alter table crm_contacts add column if not exists address       text;
alter table crm_contacts add column if not exists country       text;
alter table crm_contacts add column if not exists city          text;
alter table crm_contacts add column if not exists signature     text;
alter table crm_contacts add column if not exists signature_at  timestamptz;
-- The conversation the signature was read from, so a detail can be traced
-- back to the mail that supplied it.
alter table crm_contacts add column if not exists source_thread_id text;

alter table crm_companies add column if not exists linkedin_url text;
alter table crm_companies add column if not exists website      text;
alter table crm_companies add column if not exists address      text;
