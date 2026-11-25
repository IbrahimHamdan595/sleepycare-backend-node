// Upper bounds that match the Postgres columns (DECIMAL(10,2) and INTEGER),
// so oversized input gets a 422 instead of a database error.
export const MAX_MONEY = 99_999_999.99;
export const MAX_QUANTITY = 10_000;
