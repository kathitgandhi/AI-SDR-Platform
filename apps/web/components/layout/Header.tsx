import { createClient } from '@/lib/supabase/server';

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export async function Header({ title, subtitle, actions }: HeaderProps) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        {actions}
        <div className="flex items-center gap-2 pl-3 border-l border-slate-200">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
            <span className="text-white text-xs font-semibold">
              {user?.email?.charAt(0).toUpperCase() ?? 'U'}
            </span>
          </div>
          <span className="text-sm text-slate-600 hidden md:block">{user?.email}</span>
        </div>
      </div>
    </header>
  );
}
