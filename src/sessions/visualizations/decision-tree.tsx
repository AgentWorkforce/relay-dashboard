// Ported from Cloud session visualizations, head55bfc58fb.
"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronRight, GitBranch, RotateCcw, X } from "lucide-react";
import { Button } from "../../shell/ui";
import { tools, type SessionMember } from "./session-data";
import type { ReplayEvent } from "../model/replay-model";
import type { TranscriptCell } from "../model/transcript-cells";
import { buildDecisionTree, type DecisionCard } from "./decision-tree-model";
import { HarnessIcon, RequestAvatar, requestAuthorName, StepIcon } from "./trace-waterfall";
import styles from "./decision-tree.module.css";

type Props = {
  events: ReplayEvent[];
  transcript?: TranscriptCell[];
  source?: string;
  owners?: SessionMember[];
  autoReview?: boolean;
  partial: boolean;
  onOpenTranscript: (anchor: string) => void;
};

export function SessionDecisionTree(props: Props) {
  const data = useMemo(() => buildDecisionTree(props.events, props.transcript), [props.events, props.transcript]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [animation, setAnimation] = useState(0);
  const index = Math.max(0, data.cards.findIndex((card) => card.id === activeId));
  const card = data.cards[index];
  const navigate = (next: number) => { if (data.cards[next]) setActiveId(data.cards[next].id); };
  return <section className={styles.root} aria-label="Decision tree">
    <header className={styles.header}>
      <div className={styles.heading}><h2>{card?.kind === "choice" ? "Decision" : "Request"}</h2><span aria-live="polite">{card ? index + 1 : 0} of {data.cards.length}</span></div>
      <div className={styles.navigation}>
        <Button variant="secondary" size="icon-sm" aria-label="Previous request" disabled={index === 0} onClick={() => navigate(index - 1)}><ArrowLeft /></Button>
        <Button variant="secondary" size="icon-sm" aria-label="Next request" disabled={index >= data.cards.length - 1} onClick={() => navigate(index + 1)}><ArrowRight /></Button>
        <Button variant="secondary" size="icon-sm" aria-label="Replay tree animation" disabled={!card} onClick={() => setAnimation((value) => value + 1)}><RotateCcw /></Button>
      </div>
    </header>
    {(props.partial || data.partial) && <p className={styles.notice}>Earlier requests may still be loading.</p>}
    {card ? <DecisionScene key={`${card.id}:${animation}`} {...props} card={card} /> : <p className={styles.empty}>No requests recorded yet.</p>}
  </section>;
}

function DecisionScene({ card, events, owners = [], source, autoReview, onOpenTranscript }: Props & { card: DecisionCard }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = card.branches.find((branch) => branch.id === selectedId);
  const eventById = useMemo(() => new Map(events.map((event) => [event.eventId, event])), [events]);
  const harness = card.source || source;
  const promptEvent = card.prompt && eventById.get(card.prompt.id);
  return <div onKeyDown={(event) => {
    if (event.target !== event.currentTarget && (event.target as HTMLElement).closest("input, textarea, select, summary")) return;
    const branch = card.branches[Number(event.key) - 1];
    if (branch) { event.preventDefault(); setSelectedId(branch.id); }
    if (event.key === "Escape") setSelectedId(null);
  }}>
    <div className={styles.canvas}>
      <div className={styles.questionColumn}>
        <article className={styles.question}>
          <div className={styles.identity}>
            {card.kind === "activity" && card.prompt ? <RequestAvatar event={promptEvent} owners={owners} source={harness} autoReview={autoReview} /> : <HarnessIcon source={harness} />}
            <span>{card.kind === "activity" && card.prompt ? requestAuthorName({ event: promptEvent, owners, source: harness, autoReview }) : tools[harness ?? ""]?.label || harness || "Agent"}</span>
          </div>
          <h3 title={card.question}>{card.question}</h3>
          {card.prompt?.anchor && <button type="button" className={styles.sourceLink} onClick={() => onOpenTranscript(card.prompt!.anchor!)}>View original <ChevronRight size={12} aria-hidden="true" /></button>}
        </article>
      </div>
      <div className={styles.branches} aria-label={card.kind === "choice" ? "Recorded options" : "Recorded activity groups"}>
        {card.branches.map((branch, index) => <div key={branch.id} className={styles.branch} data-selected={selectedId === branch.id} data-chosen={branch.chosen || undefined} style={{ "--delay": `${index * 120 + 180}ms` } as CSSProperties}>
          <button type="button" className={styles.option} aria-label={`Inspect ${branch.label}`} aria-pressed={selectedId === branch.id} aria-keyshortcuts={index < 9 ? String(index + 1) : undefined} onClick={() => setSelectedId(branch.id)}>
            <span className={styles.optionHeading}><span className={styles.number}>{index + 1}</span>{card.kind === "activity" && branch.steps[0] ? <StepIcon step={branch.steps[0]} source={harness} /> : <GitBranch size={14} aria-hidden="true" />}<strong>{branch.label}</strong></span>
            {branch.chosen ? <span className={styles.chosen}><Check size={12} aria-hidden="true" />Recorded choice</span> : branch.recommended ? <span className={styles.recommended}>Recommended</span> : card.kind === "activity" ? <span className={styles.meta}>{branch.steps.length} {branch.steps.length === 1 ? "step" : "steps"}</span> : null}
          </button>
          <div className={styles.consequences}>
            {branch.effects.length ? branch.effects.map((effect, effectIndex) => <div className={styles.effect} key={`${effectIndex}:${effect}`}><span>{effect}</span></div>) : <div className={styles.effect}><span>No outcome recorded</span></div>}
            {branch.steps.some((step) => step.failed) && <span className={styles.failed}>Tool failed</span>}
          </div>
        </div>)}
        {!card.branches.length && <p className={styles.empty}>No response in the loaded history.</p>}
      </div>
    </div>
    {selected && <section className={styles.details} aria-label="Branch details">
      <header><h3>{selected.label}</h3><Button variant="secondary" size="icon-sm" aria-label="Close branch details" onClick={() => setSelectedId(null)}><X /></Button></header>
      {selected.steps.map((step) => <details key={step.id} className={styles.step}>
        <summary><StepIcon step={step} source={source} /><span>{step.label}</span>{step.failed && <span className={styles.failed}>Failed</span>}</summary>
        {step.detail && <pre aria-label="Recorded input">{step.detail}</pre>}
        {step.output && <pre aria-label="Recorded output">{step.output}</pre>}
        {step.anchor && <Button variant="secondary" size="sm" onClick={() => onOpenTranscript(step.anchor!)}>View in conversation<ArrowRight data-icon="inline-end" /></Button>}
      </details>)}
    </section>}
    {card.branches.length > 0 && <footer className={styles.footer} aria-hidden="true"><kbd>1</kbd>{card.branches.length > 1 && <>–<kbd>{Math.min(9, card.branches.length)}</kbd></>}<span>inspect</span><kbd>Esc</kbd><span>close</span></footer>}
  </div>;
}
