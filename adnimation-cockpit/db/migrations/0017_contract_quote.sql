-- Price quotes.
--
-- A quote is not yet an agreement — it is the document that precedes one — and
-- it has its own question attached: is it still outstanding. Filing quotes
-- under Demand or Supply buries them among signed contracts, so they get their
-- own pile.
alter type contract_category add value if not exists 'quote' after 'mutual';
