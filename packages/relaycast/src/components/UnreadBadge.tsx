'use client';

export default function UnreadBadge({ count }: { count?: number }) {
  if (!count || count <= 0) return null;
  const display = count > 99 ? '99+' : String(count);
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-600 px-1.5 text-xs font-medium text-white">
      {display}
    </span>
  );
}
