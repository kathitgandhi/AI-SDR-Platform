-- ============================================================
-- AI SDR PLATFORM — REPORTING VIEWS + TRIGGERS
-- Migration: 004_reporting_views.sql
-- ============================================================

-- ============================================================
-- DAILY STATS SNAPSHOT (materialized for performance)
-- ============================================================

CREATE MATERIALIZED VIEW mv_daily_stats AS
SELECT
  DATE(c.created_at) AS report_date,
  c.persona,
  c.campaign_id,
  COUNT(*) FILTER (WHERE c.status = 'completed') AS calls_completed,
  COUNT(*) FILTER (WHERE c.outcome = 'meeting_booked') AS meetings_booked,
  COUNT(*) FILTER (WHERE c.decision_maker_reached = TRUE) AS dm_reached,
  COUNT(*) FILTER (WHERE c.gatekeeper_reached = TRUE) AS gatekeeper_reached,
  COUNT(*) FILTER (WHERE c.voicemail_left = TRUE) AS voicemails_left,
  COUNT(*) FILTER (WHERE c.outcome = 'not_interested') AS not_interested,
  COUNT(*) FILTER (WHERE c.outcome = 'dnc_requested') AS dnc_requested,
  COUNT(*) FILTER (WHERE c.outcome = 'callback_requested') AS callbacks,
  AVG(c.duration_seconds) FILTER (WHERE c.duration_seconds > 0) AS avg_duration_secs,
  AVG(c.talk_time_seconds) FILTER (WHERE c.talk_time_seconds > 0) AS avg_talk_time_secs,
  AVG(c.outcome_score) FILTER (WHERE c.outcome_score IS NOT NULL) AS avg_outcome_score,
  AVG(c.qualification_score) FILTER (WHERE c.qualification_score IS NOT NULL) AS avg_qual_score
FROM calls c
GROUP BY DATE(c.created_at), c.persona, c.campaign_id
WITH DATA;

CREATE UNIQUE INDEX idx_mv_daily_stats ON mv_daily_stats(report_date, persona, campaign_id);

-- ============================================================
-- PIPELINE FUNNEL VIEW
-- ============================================================

CREATE VIEW v_pipeline_funnel AS
SELECT
  campaign_id,
  stage,
  COUNT(*) AS lead_count,
  AVG(score) AS avg_score,
  COUNT(*) FILTER (WHERE meeting_booked_at IS NOT NULL) AS meetings_booked
FROM leads
GROUP BY campaign_id, stage;

-- ============================================================
-- AGENT LEADERBOARD VIEW
-- ============================================================

CREATE VIEW v_agent_leaderboard AS
SELECT
  c.persona,
  COUNT(*) FILTER (WHERE c.status = 'completed') AS total_calls,
  COUNT(*) FILTER (WHERE c.outcome = 'meeting_booked') AS meetings_booked,
  COUNT(*) FILTER (WHERE c.decision_maker_reached = TRUE) AS dm_reached,
  ROUND(
    COUNT(*) FILTER (WHERE c.outcome = 'meeting_booked')::DECIMAL /
    NULLIF(COUNT(*) FILTER (WHERE c.status = 'completed'), 0) * 100,
    2
  ) AS meeting_rate_pct,
  ROUND(
    COUNT(*) FILTER (WHERE c.decision_maker_reached = TRUE)::DECIMAL /
    NULLIF(COUNT(*) FILTER (WHERE c.status = 'completed'), 0) * 100,
    2
  ) AS dm_rate_pct,
  ROUND(AVG(c.talk_time_seconds) FILTER (WHERE c.talk_time_seconds > 0), 0) AS avg_talk_secs,
  ROUND(AVG(c.qualification_score) FILTER (WHERE c.qualification_score IS NOT NULL), 1) AS avg_qual_score,
  MAX(c.created_at) AS last_call_at
FROM calls c
WHERE c.created_at >= NOW() - INTERVAL '30 days'
GROUP BY c.persona
ORDER BY meetings_booked DESC;

-- ============================================================
-- EMAIL PERFORMANCE VIEW
-- ============================================================

CREATE VIEW v_email_performance AS
SELECT
  es.name AS sequence_name,
  ss.step_number,
  ss.subject_template,
  COUNT(e.id) AS emails_sent,
  COUNT(e.id) FILTER (WHERE e.status = 'opened') AS opened,
  COUNT(e.id) FILTER (WHERE e.status = 'clicked') AS clicked,
  COUNT(e.id) FILTER (WHERE e.status = 'replied') AS replied,
  COUNT(e.id) FILTER (WHERE e.status = 'bounced') AS bounced,
  ROUND(
    COUNT(e.id) FILTER (WHERE e.opened_count > 0)::DECIMAL /
    NULLIF(COUNT(e.id) FILTER (WHERE e.status NOT IN ('bounced', 'failed')), 0) * 100,
    2
  ) AS open_rate_pct,
  ROUND(
    COUNT(e.id) FILTER (WHERE e.clicked_count > 0)::DECIMAL /
    NULLIF(COUNT(e.id) FILTER (WHERE e.opened_count > 0), 0) * 100,
    2
  ) AS click_to_open_pct
FROM emails e
JOIN sequence_steps ss ON e.sequence_step_id = ss.id
JOIN email_sequences es ON ss.sequence_id = es.id
GROUP BY es.name, ss.step_number, ss.subject_template
ORDER BY es.name, ss.step_number;

-- ============================================================
-- COST TRACKING VIEW
-- ============================================================

CREATE VIEW v_daily_costs AS
SELECT
  DATE(created_at) AS report_date,
  provider,
  operation,
  COUNT(*) AS request_count,
  SUM(input_tokens) AS total_input_tokens,
  SUM(output_tokens) AS total_output_tokens,
  SUM(units_consumed) AS total_units,
  SUM(cost_usd) AS total_cost_usd
FROM api_usage
GROUP BY DATE(created_at), provider, operation
ORDER BY report_date DESC, total_cost_usd DESC;

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER companies_updated_at BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER leads_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER campaigns_updated_at BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER calls_updated_at BEFORE UPDATE ON calls
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER emails_updated_at BEFORE UPDATE ON emails
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER agent_personas_updated_at BEFORE UPDATE ON agent_personas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE dnc_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_logs ENABLE ROW LEVEL SECURITY;

-- Service role bypass (used by backend)
CREATE POLICY "service_role_all" ON companies FOR ALL TO service_role USING (TRUE);
CREATE POLICY "service_role_all" ON contacts FOR ALL TO service_role USING (TRUE);
CREATE POLICY "service_role_all" ON leads FOR ALL TO service_role USING (TRUE);
CREATE POLICY "service_role_all" ON calls FOR ALL TO service_role USING (TRUE);
CREATE POLICY "service_role_all" ON call_transcripts FOR ALL TO service_role USING (TRUE);
CREATE POLICY "service_role_all" ON emails FOR ALL TO service_role USING (TRUE);
CREATE POLICY "service_role_all" ON dnc_list FOR ALL TO service_role USING (TRUE);
CREATE POLICY "service_role_all" ON compliance_logs FOR ALL TO service_role USING (TRUE);

-- ============================================================
-- PERSONA SEED DATA
-- ============================================================

INSERT INTO agent_personas (name, display_name, elevenlabs_agent_id, voice_id, tone, style, opening_style)
VALUES
  ('mike',   'Mike',   'PLACEHOLDER_MIKE_AGENT_ID',   'PLACEHOLDER_MIKE_VOICE',   'confident and direct',    'consultative, gets to the point quickly',        'direct opener, minimal small talk'),
  ('sarah',  'Sarah',  'PLACEHOLDER_SARAH_AGENT_ID',  'PLACEHOLDER_SARAH_VOICE',  'warm and conversational', 'relationship-focused, empathetic listener',       'friendly, asks about their day briefly'),
  ('david',  'David',  'PLACEHOLDER_DAVID_AGENT_ID',  'PLACEHOLDER_DAVID_VOICE',  'analytical and precise',  'data-driven, references industry benchmarks',     'leads with a relevant stat or insight'),
  ('rachel', 'Rachel', 'PLACEHOLDER_RACHEL_AGENT_ID', 'PLACEHOLDER_RACHEL_VOICE', 'energetic and curious',   'enthusiastic, asks lots of discovery questions',  'opens with genuine curiosity'),
  ('chris',  'Chris',  'PLACEHOLDER_CHRIS_AGENT_ID',  'PLACEHOLDER_CHRIS_VOICE',  'casual and approachable', 'peer-to-peer tone, avoids corporate speak',       'conversational, peer-level rapport'),
  ('emma',   'Emma',   'PLACEHOLDER_EMMA_AGENT_ID',   'PLACEHOLDER_EMMA_VOICE',   'professional and polished','structured, methodical qualification approach',   'clear value proposition upfront'),
  ('daniel', 'Daniel', 'PLACEHOLDER_DANIEL_AGENT_ID', 'PLACEHOLDER_DANIEL_VOICE', 'strategic and insightful', 'C-suite comfortable, talks business outcomes',    'leads with business impact framing');
