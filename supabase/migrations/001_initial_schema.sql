-- Stores time-series data from all sources
CREATE TABLE economic_data (
  id BIGSERIAL PRIMARY KEY,
  series_id TEXT NOT NULL,
  date DATE NOT NULL,
  value NUMERIC NOT NULL,
  source TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(series_id, date)
);

-- Article predictions as reference points
CREATE TABLE predictions (
  id SERIAL PRIMARY KEY,
  section TEXT NOT NULL,
  claim TEXT NOT NULL,
  metric TEXT,
  threshold NUMERIC,
  target_date DATE,
  verdict TEXT DEFAULT 'early',
  notes TEXT
);

-- Editorial verdicts per section
CREATE TABLE verdicts (
  id SERIAL PRIMARY KEY,
  section TEXT UNIQUE NOT NULL,
  verdict TEXT NOT NULL,
  commentary TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS, allow anonymous reads
ALTER TABLE economic_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON economic_data FOR SELECT USING (true);
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON predictions FOR SELECT USING (true);
ALTER TABLE verdicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON verdicts FOR SELECT USING (true);

-- Index for fast series lookups
CREATE INDEX idx_economic_data_series ON economic_data(series_id, date);
