export interface DataPoint {
  date: string;
  value: number | null;
}

export interface SaaSDataPoint {
  date: string;
  servicenow: number | null;
  salesforce: number | null;
  hubspot: number | null;
  freshworks: number | null;
  workday: number | null;
  datadog: number | null;
}

export interface InferenceCostPoint {
  date: string;
  gpt4: number | null;
  claude: number | null;
  label: string;
}

export interface LayoffDataPoint {
  date: string;
  count: number | null;
  workers: number | null;
}

export interface Prediction {
  section: string;
  claim: string;
  metric?: string;
  threshold?: number;
  targetDate?: string;
  verdict: VerdictType;
}

export type VerdictType = 'confirmed' | 'trending' | 'early' | 'wrong';

export interface DelinquencyDataPoint {
  date: string;
  cc: number | null;
  mortgage: number | null | undefined;
}

export interface ArticleClaim {
  id: string;
  section: 'ai' | 'saas' | 'labor' | 'consumer' | 'financial';
  claim: string;
  metric?: string;
  direction?: 'above' | 'below';
  threshold?: number;
  thresholdLabel?: string;
  targetDate?: string;
  verdict: VerdictType;
  notes?: string;
}

// ---------- agent (mirrors shapes written by supabase/functions/agent-tick) ----------

export type AgentPhase = 'counterfactual_grind' | 'inflection';
export type TickType = 'premarket' | 'close' | 'weekly';

export interface AgentProposal {
  action: 'open' | 'add' | 'trim' | 'close' | 'roll' | 'hold' | 'unwind_all';
  ticker: string;
  instrument: 'equity' | 'put' | 'call' | 'put_spread' | 'call_spread';
  expiry?: string | null;
  strike?: number | null;
  size_hint: 'starter' | 'half' | 'full' | 'trim_third' | 'trim_half';
  rationale: string;
  urgency: 'act_today' | 'this_week' | 'waiting_for_trigger';
}

export interface AgentDigest {
  id: string;
  tick_id: string;
  created_at: string;
  tick_type: TickType;
  phase: AgentPhase;
  fired_count: number;
  kill_switch_triggered: boolean;
  narrative: string;
  proposals: AgentProposal[];
  drift_notes: string | null;
  scorecard: Record<string, 'fired' | 'pending' | 'reversed'> | null;
  delivered_email: boolean;
  delivered_slack: boolean;
  cost_input_tokens: number | null;
  cost_output_tokens: number | null;
  cost_cache_read_tokens: number | null;
  cost_cache_creation_tokens: number | null;
  cost_model: string | null;
  reasoner_status: string | null;
}

export interface AgentConfig {
  id: number;
  enabled: boolean;
  mode: 'signal_only' | 'auto_execute';
  consecutive_failures: number;
  killed_reason: string | null;
  updated_at: string;
}
