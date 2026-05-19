import { Header } from '@/components/layout/Header';

export default function SettingsPage() {
  return (
    <>
      <Header title="Settings" subtitle="Platform configuration" />
      <div className="p-6">
        <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm text-center max-w-md mx-auto mt-8">
          <p className="text-slate-500 text-sm">Settings panel coming soon.</p>
          <p className="text-xs text-slate-400 mt-1">Use the MCP server for advanced platform control via Claude.</p>
        </div>
      </div>
    </>
  );
}
