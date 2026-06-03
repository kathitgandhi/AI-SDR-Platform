-- ============================================================
-- 009 — Seed email_sequences + sequence_steps
-- ------------------------------------------------------------
-- The transcript worker enrolls contacts into a sequence by NAME
-- (call-outcome-scorer.ts -> sequenceToTrigger), looking it up in
-- email_sequences WHERE name = ? AND is_active = TRUE. Until now the
-- table was empty, so enrollment always early-returned and no
-- follow-up email was ever scheduled.
--
-- This migration seeds every sequence the scorer can emit:
--   meeting_confirmation, cold_followup, no_answer_email,
--   nurture_30d, nurture_90d, nurture_180d
-- plus post_demo and reactivation (used by human-rep / reactivation flows).
--
-- Mirrors packages/core/src/sequences/sequence-definitions.ts. Step
-- content (subject/body) is AI-generated at send time by the
-- email-sequence + email-sender workers; body_template here is a plain
-- fallback only (the column is NOT NULL). personalization_prompt holds
-- the prompt key from the code definitions.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- sequences ----------
INSERT INTO email_sequences (name, description, trigger_event, is_active, total_steps) VALUES
  ('cold_followup',       'Follow-up after a call where we spoke briefly but didn''t book a meeting', 'call_connected_no_meeting', TRUE, 4),
  ('no_answer_email',     'Email sequence for prospects we couldn''t reach by phone',                 'no_answer',                 TRUE, 3),
  ('meeting_confirmation','Confirmation and prep email for booked meetings',                          'meeting_booked',            TRUE, 2),
  ('post_demo',           'Follow-up after a demo or discovery call with a human rep',                'demo_held',                 TRUE, 3),
  ('nurture_30d',         '30-day nurture for interested but not ready prospects',                    'not_ready_30d',             TRUE, 3),
  ('nurture_90d',         '90-day nurture for cold/competitor-locked prospects',                      'not_ready_90d',             TRUE, 3),
  ('nurture_180d',        '180-day nurture for long-horizon prospects',                               'not_ready_180d',            TRUE, 3),
  ('reactivation',        'Reactivation sequence for prospects who went cold 180+ days ago',          'reactivation',              TRUE, 3)
ON CONFLICT (name) DO UPDATE
  SET description   = EXCLUDED.description,
      trigger_event = EXCLUDED.trigger_event,
      is_active     = TRUE,
      total_steps   = EXCLUDED.total_steps,
      updated_at    = NOW();

-- ---------- steps ----------
-- Helper note: body_template is a generic fallback; real copy is AI-generated.
INSERT INTO sequence_steps
  (sequence_id, step_number, delay_days, delay_hours, subject_template, body_template, personalization_prompt, send_time_hour)
SELECT s.id, v.step_number, v.delay_days, v.delay_hours, v.subject_template, v.body_template, v.personalization_prompt, v.send_time_hour
FROM (
  VALUES
    -- cold_followup
    ('cold_followup', 1, 0,  2, 'Following up — {company_name} + {seller_company}',          'Hi {contact_first_name}, following up on our call.',                 'cold_followup_step1',         9),
    ('cold_followup', 2, 3,  0, 'Quick question about your price change process',            'Hi {contact_first_name}, a quick question about your workflow.',     'cold_followup_step2',        10),
    ('cold_followup', 3, 7,  0, '{vertical} case study — {store_count_range} stores',        'Hi {contact_first_name}, thought this case study might be useful.',   'cold_followup_step3',         9),
    ('cold_followup', 4, 14, 0, 'Last note from {seller_company}',                           'Hi {contact_first_name}, closing the loop on my end.',               'cold_followup_step4_breakup', 9),
    -- no_answer_email
    ('no_answer_email', 1, 0,  4, 'Tried to reach you — {company_name}',                                  'Hi {contact_first_name}, tried reaching you by phone today.',        'no_answer_step1', 10),
    ('no_answer_email', 2, 4,  0, 'One thing {vertical} retailers are doing differently in 2026',         'Hi {contact_first_name}, a quick industry note.',                    'no_answer_step2',  9),
    ('no_answer_email', 3, 10, 0, 'Quick question — still relevant for {company_name}?',                   'Hi {contact_first_name}, is this still worth a conversation?',       'no_answer_step3',  8),
    -- meeting_confirmation
    ('meeting_confirmation', 1,  0, 0, 'Confirmed: {meeting_date} — {company_name} + {seller_company}',    'Hi {contact_first_name}, confirming our meeting.',                   'meeting_confirmation_step1', 9),
    ('meeting_confirmation', 2, -1, 0, 'See you tomorrow — quick prep for our call',                       'Hi {contact_first_name}, looking forward to our call tomorrow.',     'meeting_reminder_step2',     9),
    -- post_demo
    ('post_demo', 1, 0,  2, 'Great talking — next steps for {company_name}',          'Hi {contact_first_name}, great talking today. Here are next steps.', 'post_demo_step1', 14),
    ('post_demo', 2, 5,  0, 'Answers to your questions from {meeting_date}',          'Hi {contact_first_name}, following up with the answers we discussed.','post_demo_step2',  9),
    ('post_demo', 3, 14, 0, 'Checking in — {company_name} evaluation',                'Hi {contact_first_name}, checking in on your evaluation.',           'post_demo_step3',  9),
    -- nurture_30d
    ('nurture_30d', 1, 7,  0, 'How {vertical} retailers are preparing for Q4',                          'Hi {contact_first_name}, sharing something relevant to your space.', 'nurture_30d_step1', 9),
    ('nurture_30d', 2, 14, 0, 'ROI calculator: what''s manual price labeling actually costing you?',     'Hi {contact_first_name}, a tool you might find useful.',             'nurture_30d_step2', 9),
    ('nurture_30d', 3, 30, 0, 'Checking back in — {company_name}',                                      'Hi {contact_first_name}, checking back in.',                         'nurture_30d_step3', 9),
    -- nurture_90d
    ('nurture_90d', 1, 30, 0, 'Industry update: ESL adoption in {vertical}',                            'Hi {contact_first_name}, an industry update for you.',               'nurture_90d_step1', 9),
    ('nurture_90d', 2, 60, 0, 'Case study: {comparable_company} reduced labor 70% in 6 months',          'Hi {contact_first_name}, thought this result would interest you.',   'nurture_90d_step2', 9),
    ('nurture_90d', 3, 90, 0, 'Still relevant? Quick check-in',                                          'Hi {contact_first_name}, is this still on your radar?',              'nurture_90d_step3', 9),
    -- nurture_180d
    ('nurture_180d', 1, 30,  0, 'Keeping you in the loop — {vertical} tech in 2026',                     'Hi {contact_first_name}, keeping you posted on what''s changing.',   'nurture_90d_step1', 9),
    ('nurture_180d', 2, 90,  0, 'A result worth sharing from a {vertical} retailer',                     'Hi {contact_first_name}, a recent result you may find relevant.',    'nurture_90d_step2', 9),
    ('nurture_180d', 3, 180, 0, 'Still worth a conversation, {company_name}?',                           'Hi {contact_first_name}, worth reconnecting?',                       'nurture_90d_step3', 9),
    -- reactivation
    ('reactivation', 1, 0,  0, 'It''s been a while — still thinking about store tech at {company_name}?', 'Hi {contact_first_name}, it''s been a while since we connected.',    'reactivation_step1',          9),
    ('reactivation', 2, 7,  0, 'What''s changed since we last talked',                                   'Hi {contact_first_name}, a few things have changed worth sharing.',  'reactivation_step2',          9),
    ('reactivation', 3, 21, 0, 'Final note — {company_name} + {seller_company}',                         'Hi {contact_first_name}, closing the loop for now.',                 'reactivation_step3_breakup',  9)
) AS v(seq_name, step_number, delay_days, delay_hours, subject_template, body_template, personalization_prompt, send_time_hour)
JOIN email_sequences s ON s.name = v.seq_name
ON CONFLICT (sequence_id, step_number) DO NOTHING;
