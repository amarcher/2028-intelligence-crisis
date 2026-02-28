# 2028 Intelligence Crisis Tracker

Real-time economic data dashboard tracking [Citrini Research's](https://www.citriniresearch.com/p/2028gic) February 2026 macro scenario — the predicted "2028 Global Intelligence Crisis" — against actual FRED economic data.

## The Thesis

AI capability acceleration → SaaS revenue disruption → white-collar labor displacement → consumer spending collapse → financial contagion. This dashboard tracks each link in the causal chain with live data.

## Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Recharts
- **Backend:** Supabase (Postgres + Edge Functions)
- **Data:** FRED API (14 economic series), manual SaaS/layoffs data
- **Hosting:** Vercel

## Development

```bash
npm install
npm run dev
```

## Environment Variables

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```bash
cp .env.example .env
```

See `.env.example` for required variables.

## License

MIT
