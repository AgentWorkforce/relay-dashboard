'use client';

export default function NewMessagePill({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-20 left-1/2 z-10 -translate-x-1/2 rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white shadow-lg transition hover:bg-indigo-500"
    >
      New messages
    </button>
  );
}
