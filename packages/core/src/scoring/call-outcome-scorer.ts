import { CallOutcome, QualificationData } from '@ai-sdr/database';

export interface CallOutcomeScore {
  outcomeScore: number;        // 0-100: quality of this specific call
  qualificationScore: number;  // 0-100: how qualified the lead is based on call data
  nextAction: RecommendedAction;
  nextContactAt: Date | null;
  sequenceToTrigger: SequenceName | null;
  newLeadStage: string;
}

export type RecommendedAction =
  | 'book_meeting'
  | 'schedule_callback'
  | 'send_followup_email'
  | 'enroll_nurture_30d'
  | 'enroll_nurture_90d'
  | 'enroll_nurture_180d'
  | 'add_dnc'
  | 'mark_dead'
  | 'retry_call_same_day'
  | 'retry_call_next_day'
  | 'retry_call_next_week';

export type SequenceName =
  | 'cold_followup'
  | 'no_answer_email'
  | 'meeting_confirmation'
  | 'post_demo'
  | 'nurture_30d'
  | 'nurture_90d'
  | 'nurture_180d'
  | 'reactivation';

export class CallOutcomeScorer {
  score(
    outcome: CallOutcome,
    qualification: Partial<QualificationData>,
    callAttempt: number,
    maxAttempts: number
  ): CallOutcomeScore {
    const qualScore = this.computeQualificationScore(qualification);
    let outcomeScore = 0;
    let nextAction: RecommendedAction;
    let nextContactAt: Date | null = null;
    let sequenceToTrigger: SequenceName | null = null;
    let newLeadStage = 'called_no_answer';

    switch (outcome) {
      case 'meeting_booked':
        outcomeScore = 95;
        nextAction = 'book_meeting';
        sequenceToTrigger = 'meeting_confirmation';
        newLeadStage = 'meeting_booked';
        break;

      case 'callback_requested':
        outcomeScore = 70;
        nextAction = 'schedule_callback';
        nextContactAt = this.addBusinessDays(new Date(), 2);
        sequenceToTrigger = 'cold_followup';
        newLeadStage = 'connected';
        break;

      case 'qualified_nurture':
        outcomeScore = 55;
        nextAction = qualScore >= 50 ? 'enroll_nurture_30d' : 'enroll_nurture_90d';
        sequenceToTrigger = qualScore >= 50 ? 'nurture_30d' : 'nurture_90d';
        newLeadStage = qualScore >= 50 ? 'nurturing_30d' : 'nurturing_90d';
        break;

      case 'not_interested':
        outcomeScore = 5;
        nextAction = 'enroll_nurture_180d';
        sequenceToTrigger = 'nurture_180d';
        newLeadStage = 'nurturing_180d';
        nextContactAt = this.addDays(new Date(), 180);
        break;

      case 'using_competitor':
        outcomeScore = 20;
        nextAction = 'enroll_nurture_90d';
        sequenceToTrigger = 'nurture_90d';
        newLeadStage = 'nurturing_90d';
        nextContactAt = this.addDays(new Date(), 90);
        break;

      case 'already_customer':
        outcomeScore = 0;
        nextAction = 'mark_dead';
        newLeadStage = 'dead';
        break;

      case 'too_small':
        outcomeScore = 0;
        nextAction = 'mark_dead';
        newLeadStage = 'disqualified';
        break;

      case 'wrong_number':
        outcomeScore = 0;
        nextAction = 'mark_dead';
        newLeadStage = 'dead';
        break;

      case 'dnc_requested':
        outcomeScore = 0;
        nextAction = 'add_dnc';
        newLeadStage = 'dnc';
        break;

      case 'gatekeeper_blocked':
        outcomeScore = 15;
        if (callAttempt < maxAttempts) {
          nextAction = 'retry_call_next_day';
          nextContactAt = this.addBusinessDays(new Date(), 1);
        } else {
          nextAction = 'send_followup_email';
          sequenceToTrigger = 'no_answer_email';
          newLeadStage = 'called_gatekeeper';
        }
        break;

      case 'not_decision_maker':
        outcomeScore = 25;
        nextAction = 'send_followup_email';
        sequenceToTrigger = 'cold_followup';
        newLeadStage = 'called_gatekeeper';
        nextContactAt = this.addBusinessDays(new Date(), 3);
        break;

      case 'voicemail_left':
        outcomeScore = callAttempt === 1 ? 30 : callAttempt === 2 ? 20 : 10;
        if (callAttempt < maxAttempts) {
          nextAction = 'retry_call_next_day';
          nextContactAt = this.addBusinessDays(new Date(), 2);
          sequenceToTrigger = 'no_answer_email';
          newLeadStage = 'called_voicemail';
        } else {
          nextAction = 'enroll_nurture_30d';
          sequenceToTrigger = 'nurture_30d';
          newLeadStage = 'nurturing_30d';
        }
        break;

      case 'voicemail_full':
      case 'no_answer':
      case 'busy':
        outcomeScore = 10;
        if (callAttempt < maxAttempts) {
          const delay = callAttempt === 1 ? 'retry_call_same_day' : 'retry_call_next_day';
          nextAction = delay;
          nextContactAt = callAttempt === 1
            ? this.addHours(new Date(), 4)
            : this.addBusinessDays(new Date(), 1);
          newLeadStage = 'called_no_answer';
        } else {
          nextAction = 'send_followup_email';
          sequenceToTrigger = 'no_answer_email';
          newLeadStage = 'email_only';
        }
        break;

      default:
        outcomeScore = 5;
        nextAction = 'send_followup_email';
        sequenceToTrigger = 'no_answer_email';
    }

    return {
      outcomeScore,
      qualificationScore: qualScore,
      nextAction,
      nextContactAt,
      sequenceToTrigger,
      newLeadStage,
    };
  }

  private computeQualificationScore(q: Partial<QualificationData>): number {
    let score = 0;

    if (q.budget_confirmed) score += 25;
    if (q.authority_confirmed) score += 25;
    if (q.need_confirmed) score += 25;
    if (q.timeline_confirmed) score += 25;

    // Bonus signals
    if (q.store_count && q.store_count >= 20) score = Math.min(score + 10, 100);
    if (q.store_count && q.store_count >= 100) score = Math.min(score + 10, 100);
    if (!q.current_esl_vendor) score = Math.min(score + 5, 100);

    return Math.min(score, 100);
  }

  private addBusinessDays(date: Date, days: number): Date {
    const result = new Date(date);
    let added = 0;
    while (added < days) {
      result.setDate(result.getDate() + 1);
      const dow = result.getDay();
      if (dow !== 0 && dow !== 6) added++;
    }
    return result;
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  private addHours(date: Date, hours: number): Date {
    const result = new Date(date);
    result.setHours(result.getHours() + hours);
    return result;
  }
}
