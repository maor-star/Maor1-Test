-- Consulting agreements.
--
-- Neither demand nor supply: the advisers, agencies and contractors the company
-- engages. They were landing under General, which is where a category goes to
-- be lost — the folder nobody opens because it holds everything that did not
-- fit.
alter type contract_category add value if not exists 'consulting' after 'quote';
