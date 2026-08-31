-- Contracts that are both demand and supply.
--
-- A partner we buy from and sell to is common, and forcing one of those
-- agreements onto a single side files it where it will not be looked for. It
-- gets its own category and its own folder rather than being filed under
-- whichever side happened to win a tie.
alter type contract_category add value if not exists 'mutual' after 'supply';
