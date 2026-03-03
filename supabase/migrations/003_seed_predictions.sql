-- Seed predictions table with article claims from the Citrini Research "2028 GIC" article
-- These can be updated editorially without code deploys

INSERT INTO predictions (section, claim, metric, threshold, target_date, verdict, notes) VALUES
  ('ai', 'Inference cost falls below $1/M tokens for GPT-4 class models', NULL, 1, NULL, 'confirmed', 'GPT-4o mini at $0.60 and Haiku 3.5 at $0.80 per 1M output tokens as of late 2024.'),
  ('saas', 'ServiceNow net-new ACV growth decelerates to 14% by Q3 2026', 'servicenow', 14, '2026-09-30', 'trending', 'ServiceNow revenue growth trending from 25% in 2023 to high teens in 2025.'),
  ('labor', 'Initial unemployment claims surge to 487,000 by Q3 2027', 'ICSA', 487000, '2027-09-30', 'early', 'Initial claims remain around 215-230K, well below crisis levels.'),
  ('labor', 'Unemployment rate hits 10.2% by June 2028', 'UNRATE', 10.2, '2028-06-30', 'early', 'Unemployment at ~4.0%, no meaningful upward trend yet.'),
  ('labor', 'JOLTS job openings fall below 5.5M by October 2026', 'JTSJOL', 5500, '2026-10-31', 'trending', 'JOLTS trending down from 9M+ but still well above 5.5M.'),
  ('labor', 'Real wages collapse as labor market weakens in 2026-2027', 'LES1252881600Q', NULL, NULL, 'early', 'Real wages have been modestly growing. No collapse signal yet.'),
  ('consumer', 'M2 velocity of money flatlines as human spending declines', 'M2V', NULL, NULL, 'wrong', 'M2 velocity has been recovering post-COVID, not flatlined.'),
  ('consumer', 'Labor share of nonfarm business drops to 46%', 'PRS85006173', 46, NULL, 'early', 'Labor share around 58%, well above crisis level.'),
  ('consumer', 'Productivity surge not seen since the 1950s as AI automates tasks', 'OPHNFB', NULL, NULL, 'early', 'Watching for acceleration in output per hour from AI adoption.'),
  ('consumer', 'Federal receipts fall 12% below CBO baseline by Q1 2028', 'W006RC1Q027SBEA', NULL, '2028-03-31', 'early', 'Tax receipts tracking near baseline. No structural decline yet.'),
  ('financial', 'S&P 500 reaches ~8000 by October 2026 driven by AI productivity narrative', 'SP500', 8000, '2026-10-31', 'trending', 'S&P 500 in the 5800-6100 range, AI enthusiasm continues.'),
  ('financial', 'S&P 500 crashes to ~3500 as labor crisis hits consumer spending', 'SP500', 3500, NULL, 'early', 'No crash indicators. Market remains near all-time highs.'),
  ('financial', 'San Francisco home prices decline 11% YoY', NULL, NULL, NULL, 'early', 'SF housing showing weakness but far from -11% YoY.'),
  ('financial', 'Seattle home prices decline 9% YoY', NULL, NULL, NULL, 'early', 'Seattle housing remains stable.'),
  ('financial', 'National home prices begin declining as tech layoffs spread', 'CSUSHPISA', NULL, NULL, 'early', 'Case-Shiller national index still rising.')
ON CONFLICT DO NOTHING;
