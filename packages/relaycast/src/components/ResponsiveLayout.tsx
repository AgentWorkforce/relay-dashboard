'use client';

import { useEffect, useState } from 'react';

type Breakpoint = 'mobile' | 'tablet' | 'desktop';

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>('desktop');

  useEffect(() => {
    function update() {
      const w = window.innerWidth;
      if (w < 768) setBp('mobile');
      else if (w < 1024) setBp('tablet');
      else setBp('desktop');
    }
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return bp;
}

export default function ResponsiveLayout({
  sidebar,
  children,
  panel,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  panel?: React.ReactNode;
}) {
  const bp = useBreakpoint();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0a0f]">
      {/* Sidebar */}
      {bp === 'desktop' ? (
        <div className="w-60 flex-shrink-0 border-r border-white/10">
          {sidebar}
        </div>
      ) : bp === 'tablet' ? (
        sidebarOpen && (
          <div className="absolute inset-y-0 left-0 z-30 w-60 border-r border-white/10 bg-[#0a0a0f]">
            {sidebar}
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute right-2 top-2 text-text-muted"
            >
              X
            </button>
          </div>
        )
      ) : (
        sidebarOpen && (
          <div className="fixed inset-0 z-40">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setSidebarOpen(false)}
            />
            <div className="relative z-50 h-full w-72 border-r border-white/10 bg-[#0a0a0f]">
              {sidebar}
            </div>
          </div>
        )
      )}

      {/* Toggle button for mobile/tablet */}
      {bp !== 'desktop' && !sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="absolute left-2 top-2 z-20 rounded bg-white/10 px-2 py-1 text-xs text-text"
        >
          Menu
        </button>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">{children}</main>

      {/* Panel */}
      {panel && bp === 'desktop' && (
        <div className="w-96 flex-shrink-0 border-l border-white/10">
          {panel}
        </div>
      )}
      {panel && bp === 'tablet' && (
        <div className="absolute inset-y-0 right-0 z-30 w-96 border-l border-white/10 bg-[#0a0a0f]">
          {panel}
        </div>
      )}
    </div>
  );
}
