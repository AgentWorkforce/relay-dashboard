'use client';

interface Reaction {
  emoji: string;
  count: number;
  agents: string[];
}

interface ReactionChipsProps {
  reactions: Reaction[];
  onToggle: (emoji: string) => void;
}

export default function ReactionChips({ reactions, onToggle }: ReactionChipsProps) {
  if (!reactions || reactions.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          onClick={() => onToggle(r.emoji)}
          className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs transition hover:border-accent hover:bg-accent-glow"
          title={r.agents.join(', ')}
        >
          <span>{r.emoji}</span>
          <span className="text-text-muted">{r.count}</span>
        </button>
      ))}
    </div>
  );
}
