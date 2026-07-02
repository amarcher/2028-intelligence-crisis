// Supabase Edge Function: news-pulse
//
// The cheap unstructured-text layer (roadmap M2, Path B from the active-layer
// plan): once a day (cron 11:00 UTC, before the premarket tick) pull the last
// ~24h of Google News headlines per tracked name, triage the whole batch with
// ONE Haiku call, and persist per-ticker features into signal_features:
//
//   news_sentiment            −2…+2
//   layoff_mentions           count of headlines about layoffs at the company
//   ai_displacement_mentions  count about AI replacing the product/seats
//   guidance_cut_mentions     count about guidance cuts / weak outlook
//
// agent-tick reads the latest features and hands the reasoner a compact
// "News pulse" block. Corroborator only — prompts forbid trading on it alone.
// Budget: ~30 headlines/ticker/day through Haiku ≈ single-digit $/month.
//
// Deploy: supabase functions deploy news-pulse

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// Ticker → news search query. Company names beat tickers for RSS relevance.
const TRACKED: Array<{ ticker: string; query: string }> = [
  { ticker: 'NOW', query: '"ServiceNow"' },
  { ticker: 'CRM', query: '"Salesforce"' },
  { ticker: 'WDAY', query: '"Workday"' },
  { ticker: 'HUBS', query: '"HubSpot"' },
  { ticker: 'FRSH', query: '"Freshworks"' },
  { ticker: 'DDOG', query: '"Datadog"' },
  { ticker: 'MSFT', query: '"Microsoft" AI' },
  { ticker: 'NVDA', query: '"Nvidia"' },
  // Macro basket — not a tradable ticker; shows up as MACRO in the pulse.
  { ticker: 'MACRO', query: 'AI layoffs white-collar jobs' },
];

const MAX_HEADLINES_PER_TICKER = 15;

async function fetchHeadlines(query: string): Promise<string[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:1d`)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (CrisisTracker news pulse)' } });
  if (!res.ok) throw new Error(`rss ${res.status}`);
  const xml = await res.text();
  // <item><title>…</title> — first <title> in the doc is the channel's; skip it.
  const titles = [...xml.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/g)]
    .map((m) => m[1].trim())
    .filter((t) => t.length > 0);
  return titles.slice(0, MAX_HEADLINES_PER_TICKER);
}

interface TickerTriage {
  ticker: string;
  sentiment: number;
  layoff_mentions: number;
  ai_displacement_mentions: number;
  guidance_cut_mentions: number;
  notable: string | null;
}

const TRIAGE_TOOL = {
  name: 'submit_triage',
  description: 'Submit the headline triage for every ticker. Call exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      tickers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ticker: { type: 'string' },
            sentiment: { type: 'integer', minimum: -2, maximum: 2 },
            layoff_mentions: { type: 'integer', minimum: 0 },
            ai_displacement_mentions: { type: 'integer', minimum: 0 },
            guidance_cut_mentions: { type: 'integer', minimum: 0 },
            notable: { type: ['string', 'null'], description: 'Single most decision-relevant headline, or null.' },
          },
          required: ['ticker', 'sentiment', 'layoff_mentions', 'ai_displacement_mentions', 'guidance_cut_mentions'],
        },
      },
    },
    required: ['tickers'],
  },
};

const TRIAGE_SYSTEM = `You triage news headlines for a macro dashboard tracking whether AI is disrupting seat-based enterprise software (the "2028 GIC" scenario). For each ticker's headline batch, score:
- sentiment: overall business outlook implied by the headlines, -2 (very negative) to +2 (very positive). 0 for noise/PR fluff.
- layoff_mentions: headlines about layoffs AT that company.
- ai_displacement_mentions: headlines about AI/agents replacing that company's product, seats, or category (for MACRO: AI displacing white-collar work broadly).
- guidance_cut_mentions: headlines about lowered guidance, slowing growth, missed expectations.
- notable: the ONE headline a portfolio manager would want to see, or null.
Count conservatively — a headline must actually be about the thing, not merely contain a keyword. Call submit_triage exactly once.`;

async function triage(
  apiKey: string,
  batches: Array<{ ticker: string; headlines: string[] }>,
): Promise<TickerTriage[]> {
  const userMsg = batches
    .map((b) => `## ${b.ticker}\n${b.headlines.length > 0 ? b.headlines.map((h) => `- ${h}`).join('\n') : '(no headlines found)'}`)
    .join('\n\n');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 2048,
      system: TRIAGE_SYSTEM,
      tools: [TRIAGE_TOOL],
      tool_choice: { type: 'tool', name: 'submit_triage' },
      messages: [{ role: 'user', content: userMsg }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const toolUse = (body.content ?? []).find(
    (b: { type: string; name?: string }) => b.type === 'tool_use' && b.name === 'submit_triage',
  );
  if (!toolUse) throw new Error('no submit_triage tool call in response');
  return (toolUse.input?.tickers ?? []) as TickerTriage[];
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const summary = { tickers: 0, headlines: 0, rows: 0, errors: [] as string[] };

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

    const batches: Array<{ ticker: string; headlines: string[] }> = [];
    for (const t of TRACKED) {
      try {
        const headlines = await fetchHeadlines(t.query);
        batches.push({ ticker: t.ticker, headlines });
        summary.headlines += headlines.length;
      } catch (e) {
        summary.errors.push(`rss ${t.ticker}: ${String(e).slice(0, 120)}`);
        batches.push({ ticker: t.ticker, headlines: [] });
      }
    }
    if (summary.headlines === 0) {
      return json({ ...summary, note: 'no headlines fetched — skipping triage' });
    }

    const triaged = await triage(apiKey, batches);
    summary.tickers = triaged.length;

    const observedAt = new Date().toISOString();
    const headlineCount = new Map(batches.map((b) => [b.ticker, b.headlines.length]));
    const rows = triaged.flatMap((t) => {
      const detail = { notable: t.notable ?? null, headline_count: headlineCount.get(t.ticker) ?? 0 };
      return [
        { observed_at: observedAt, ticker: t.ticker, feature: 'news_sentiment', value: t.sentiment, detail },
        { observed_at: observedAt, ticker: t.ticker, feature: 'layoff_mentions', value: t.layoff_mentions, detail: null },
        { observed_at: observedAt, ticker: t.ticker, feature: 'ai_displacement_mentions', value: t.ai_displacement_mentions, detail: null },
        { observed_at: observedAt, ticker: t.ticker, feature: 'guidance_cut_mentions', value: t.guidance_cut_mentions, detail: null },
      ];
    });
    const { error } = await supabase.from('signal_features').insert(rows);
    if (error) throw new Error(`signal_features insert: ${error.message}`);
    summary.rows = rows.length;

    return json(summary);
  } catch (err) {
    console.error('news-pulse failed:', err);
    return json({ error: String(err), ...summary }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
