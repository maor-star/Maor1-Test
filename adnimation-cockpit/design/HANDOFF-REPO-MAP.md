repo: maor-star/Maor1-Test
branch: claude/office-management-app-rlkr6m

## Last sync

date: 2026-08-29T08:20:00Z

### Updated in this project

- Read the office-management app (Express + SQLite) as source material for the CEO cockpit.
- Grounded cockpit finance data in the repo's real entities: income, expenses, employees, time_entries.
- P&L follows the repo's formula: income − direct expenses − labor cost; currency stays ILS (₪).
- Six-month income/expense/labor trend mirrors the `/api/dashboard` trend query.

## Screen map

| Project screen | Repo files |
| --- | --- |
| CEO Cockpit — Company overview | public/app.js, server.js (`/api/dashboard`) |
| CEO Cockpit — Revenue & finance | server.js (`/api/income`, `/api/expenses`, `/api/dashboard`), db.js |
| CEO Cockpit — Publishers & clients | server.js (`/api/income`), db.js (`income.client`) |
| CEO Cockpit — People & payroll block | server.js (`/api/employees`, `/api/time-entries`), db.js |
