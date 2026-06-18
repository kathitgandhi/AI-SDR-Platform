-- ============================================================
-- Migration 016: inbound call email sequences
-- ============================================================
--
-- Adds email sequences triggered after inbound receptionist calls:
--
--   inbound_esl_inquiry   — sent when an inbound caller asks about ESL.
--                           Step 1 is immediate (delay 0), followed by
--                           a 2-day follow-up with product detail.
--
--   inbound_support_ack   — sent to existing customers who called in for
--                           support, confirming their ticket was received.
--
--   inbound_partnership   — sent to partnership/reseller inquiries.
--
-- Idempotent: safe to re-run.
-- ============================================================

INSERT INTO email_sequences (name, description, trigger_event, is_active, total_steps) VALUES
  ('inbound_esl_inquiry',
   'Follow-up sequence after an inbound ESL inquiry call',
   'inbound_esl_inquiry', TRUE, 2),
  ('inbound_support_ack',
   'Acknowledgement email after an inbound support request',
   'inbound_support', TRUE, 1),
  ('inbound_partnership',
   'Follow-up for inbound partnership / reseller inquiries',
   'inbound_partnership', TRUE, 2)
ON CONFLICT (name) DO UPDATE
  SET description   = EXCLUDED.description,
      trigger_event = EXCLUDED.trigger_event,
      is_active     = TRUE,
      total_steps   = EXCLUDED.total_steps,
      updated_at    = NOW();

-- Steps
INSERT INTO sequence_steps
  (sequence_id, step_number, delay_days, delay_hours, subject_template, body_template, personalization_prompt, send_time_hour)
SELECT s.id, v.step_number, v.delay_days, v.delay_hours, v.subject_template, v.body_template, v.personalization_prompt, v.send_time_hour
FROM (
  VALUES
    -- inbound_esl_inquiry: immediate + 2-day follow-up
    ('inbound_esl_inquiry', 1, 0, 0,
     'Thanks for calling — AirESL info for {company_name}',
     'Hi {contact_first_name}, thanks for calling AirRetail Technologies today. As discussed, here is more information about our AirESL electronic shelf label system.',
     'inbound_esl_inquiry_step1', 9),

    ('inbound_esl_inquiry', 2, 2, 0,
     'Quick follow-up — AirESL for {company_name}',
     'Hi {contact_first_name}, just following up on your ESL enquiry. Happy to answer any questions or set up a quick demo.',
     'inbound_esl_inquiry_step2', 10),

    -- inbound_support_ack: immediate single step
    ('inbound_support_ack', 1, 0, 0,
     'Your support request has been received — {company_name}',
     'Hi {contact_first_name}, thank you for calling. Your support request has been logged and a member of our team will follow up shortly.',
     'inbound_support_ack_step1', 9),

    -- inbound_partnership: immediate + 5-day follow-up
    ('inbound_partnership', 1, 0, 0,
     'Thanks for your interest in partnering with AirRetail Technologies',
     'Hi {contact_first_name}, thank you for reaching out about a partnership opportunity. Our partnerships team will review your request and be in touch.',
     'inbound_partnership_step1', 9),

    ('inbound_partnership', 2, 5, 0,
     'Following up — partnership enquiry from {company_name}',
     'Hi {contact_first_name}, just following up on your partnership enquiry. Happy to jump on a quick call to explore the fit.',
     'inbound_partnership_step2', 9)

) AS v(seq_name, step_number, delay_days, delay_hours, subject_template, body_template, personalization_prompt, send_time_hour)
JOIN email_sequences s ON s.name = v.seq_name
ON CONFLICT (sequence_id, step_number) DO NOTHING;
