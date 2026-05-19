import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getCallWithTranscript } from '@/lib/services/activity.service';
import { Header } from '@/components/layout/Header';
import { Badge } from '@/components/ui/Badge';
import { formatDuration, formatRelativeTime, capitalize } from '@/lib/utils';
import type { CallOutcome } from '@ai-sdr/database';

export default async function TranscriptPage({ params }: { params: { callId: string } }) {
  const supabase = createClient();
  const { call, transcript } = await getCallWithTranscript(supabase, params.callId);
  if (!call) notFound();

  const contact = Array.isArray((call as { contacts: unknown }).contacts)
    ? ((call as { contacts: unknown[] }).contacts)[0] as Record<string, string | null>
    : (call as { contacts: Record<string, string | null> | null }).contacts ?? {};
  const company = Array.isArray((call as { companies: unknown }).companies)
    ? ((call as { companies: unknown[] }).companies)[0] as Record<string, string | null>
    : (call as { companies: Record<string, string | null> | null }).companies ?? {};

  const contactName = `${contact['first_name'] ?? ''} ${contact['last_name'] ?? ''}`.trim() || '—';

  return (
    <>
      <Header title="Call Transcript" subtitle={`${contactName} · ${company['name'] ?? '—'}`} />

      <div className="p-6 space-y-6 max-w-3xl">
        <Link href="/activity" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="w-4 h-4" /> Back to Activity
        </Link>

        {/* Call metadata */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            {[
              { label: 'Persona', value: capitalize((call as { persona: string }).persona) },
              { label: 'Duration', value: formatDuration((call as { duration_seconds: number | null }).duration_seconds) },
              { label: 'Outcome', value: (call as { outcome: CallOutcome | null }).outcome ? capitalize((call as { outcome: string }).outcome) : '—' },
              { label: 'Time', value: formatRelativeTime((call as { created_at: string }).created_at) },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-slate-500 mb-0.5">{label}</p>
                <p className="font-medium text-slate-900">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {(call as { meeting_booked: boolean }).meeting_booked && <Badge label="Meeting Booked" variant="success" dot />}
            {(call as { decision_maker_reached: boolean }).decision_maker_reached && <Badge label="Decision Maker" variant="info" dot />}
            {(call as { voicemail_left: boolean }).voicemail_left && <Badge label="Voicemail Left" variant="warning" />}
            {(call as { dnc_requested: boolean }).dnc_requested && <Badge label="DNC Requested" variant="error" />}
          </div>
        </div>

        {/* Claude analysis */}
        {transcript?.claude_analysis && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h2 className="font-semibold text-slate-900 mb-3">AI Analysis</h2>
            <p className="text-sm text-slate-700 mb-4">{transcript.claude_analysis.summary}</p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-slate-500 mb-1">Interest Level</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-slate-100 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${transcript.claude_analysis.interest_level * 10}%` }} />
                  </div>
                  <span className="text-slate-700 font-medium">{transcript.claude_analysis.interest_level}/10</span>
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Qualification Score</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-slate-100 rounded-full h-2">
                    <div className="bg-green-500 h-2 rounded-full" style={{ width: `${transcript.claude_analysis.qualification_score}%` }} />
                  </div>
                  <span className="text-slate-700 font-medium">{transcript.claude_analysis.qualification_score}</span>
                </div>
              </div>
            </div>
            {transcript.claude_analysis.key_insights.length > 0 && (
              <div className="mt-4">
                <p className="text-xs text-slate-500 mb-2">Key Insights</p>
                <ul className="space-y-1">
                  {transcript.claude_analysis.key_insights.map((insight, i) => (
                    <li key={i} className="text-sm text-slate-700 flex gap-2"><span className="text-blue-400">·</span>{insight}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Transcript */}
        {transcript?.transcript_json ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-900">Full Transcript</h2>
            </div>
            <div className="p-5 space-y-3 max-h-[600px] overflow-y-auto">
              {transcript.transcript_json.map((turn, i) => (
                <div key={i} className={`flex gap-3 ${turn.speaker === 'agent' ? 'flex-row' : 'flex-row-reverse'}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${turn.speaker === 'agent' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
                    {turn.speaker === 'agent' ? 'AI' : 'P'}
                  </div>
                  <div className={`flex-1 max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${turn.speaker === 'agent' ? 'bg-blue-50 text-blue-900 rounded-tl-sm' : 'bg-slate-100 text-slate-900 rounded-tr-sm'}`}>
                    {turn.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : transcript?.full_transcript ? (
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h2 className="font-semibold text-slate-900 mb-3">Full Transcript</h2>
            <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans">{transcript.full_transcript}</pre>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <p className="text-sm text-slate-400 text-center py-4">
              {transcript ? 'Transcript is processing…' : 'No transcript available for this call.'}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
