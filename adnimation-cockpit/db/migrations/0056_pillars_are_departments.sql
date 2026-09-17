-- One list. "זה אותו הדבר, זה ומחלקה" — so they stop being two.
--
-- The cockpit carried two taxonomies for the same question. DEPARTMENT was a
-- single-select of fifteen rows that the ClickUp mirror sets from the list a
-- task lives in. WHICH PARTS OF THE COMPANY was a multi-select of seven
-- pillars, which is also what the Overview reports revenue against. He could
-- file a task under Trading and tag it Exchange CTV and nothing anywhere said
-- those were answers to the same question.
--
-- The pillar list wins, because it is the one he can already edit and the one
-- the revenue tiles read. Every department that is not already a pillar
-- becomes one, and each pillar that corresponds to a department carries that
-- department's id — so `tasks.dept_id` keeps being set and everything reading
-- it (the mirror's pinning, contracts, the cadence engine, the reports) keeps
-- working, while there is one list on screen and one control to pick from.
ALTER TABLE pillars ADD COLUMN IF NOT EXISTS dept_id UUID REFERENCES departments(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pillars_dept ON pillars(dept_id) WHERE dept_id IS NOT NULL;

-- Every department is on the list. Four were switched off before any of them
-- had a task — RTB In-App, RTB Display, CTV, Asia Expansion — which is why the
-- dropdown stopped at Development and nothing could be filed under CTV.
UPDATE departments SET active = TRUE WHERE active = FALSE;

-- The six pillars that already ARE a department, joined up by hand because the
-- names do not match and never did: "IBV — VIDEO" is the Video department,
-- "EXCHANGE DISPLAY" is RTB Display.
UPDATE pillars p SET dept_id = d.id
  FROM departments d
 WHERE p.dept_id IS NULL
   AND ((p.line = 'core_clients' AND d.code = 'CORE')
     OR (p.line = 'ibv'          AND d.code = 'VID')
     OR (p.line = 'rtb_display'  AND d.code = 'DISP')
     OR (p.line = 'apps'         AND d.code = 'APP')
     OR (p.line = 'ctv'          AND d.code = 'CTV')
     OR (p.line = 'bidder'       AND d.code = 'BID'));

-- Everything else the company has a department for, added to the list as a
-- pillar. TAG ONLY: no revenue source reports against Finance or HR, so they
-- get no tile on the Overview — they are still a real pillar everywhere work
-- is tagged and filtered.
INSERT INTO pillars (line, label, sort_order, active, has_revenue, dept_id)
SELECT
  lower(regexp_replace(d.code::text, '[^A-Za-z0-9]+', '_', 'g')),
  d.name_he,
  100 + row_number() OVER (ORDER BY d.code),
  TRUE,
  FALSE,
  d.id
FROM departments d
WHERE NOT EXISTS (SELECT 1 FROM pillars p WHERE p.dept_id = d.id)
ON CONFLICT (line) DO NOTHING;

-- Nothing already filed loses its filing: a task that has a department gets
-- that department's pillar as a tag, so the one control opens showing what the
-- two used to say between them.
INSERT INTO entity_lines (entity_type, entity_id, line, tagged_by)
SELECT 'task', t.id, p.line, 'merge-0056'
  FROM tasks t
  JOIN pillars p ON p.dept_id = t.dept_id
 WHERE t.dept_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Same for the contracts, which carry a department of their own.
INSERT INTO entity_lines (entity_type, entity_id, line, tagged_by)
SELECT 'contract', c.id, p.line, 'merge-0056'
  FROM contracts c
  JOIN pillars p ON p.dept_id = c.dept_id
 WHERE c.dept_id IS NOT NULL
ON CONFLICT DO NOTHING;
