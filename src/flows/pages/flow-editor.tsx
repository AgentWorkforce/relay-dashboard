import { useState, type FormEvent } from "react";
import { flowsApi } from "../api";
import { go, seg } from "../format";

export const STARTER_FLOW = `version: '1.0'
name: hello-flow
description: A deterministic starter flow
swarm:
  pattern: pipeline
workflows:
  - name: main
    steps:
      - name: generate
        type: deterministic
        command: printf 'hello from step one\\n'
      - name: transform
        type: deterministic
        dependsOn: [generate]
        command: echo "{{steps.generate.output}}" | tr '[:lower:]' '[:upper:]'
`;

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;

export function FlowForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial: {
    name: string;
    description: string;
    fileType: "yaml" | "ts";
    source: string;
  };
  submitLabel: string;
  onSubmit: (value: typeof initial) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameValid = NAME.test(value.name);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!nameValid || !value.source.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={(event) => void submit(event)}>
      <label>
        Name
        <input
          value={value.name}
          required
          aria-invalid={!nameValid && value.name !== ""}
          placeholder="nightly-report"
          onChange={(event) => setValue({ ...value, name: event.target.value })}
        />
        <small>Letters, digits, dashes, and underscores.</small>
      </label>
      <label>
        Description
        <input
          value={value.description}
          placeholder="What this flow does"
          onChange={(event) =>
            setValue({ ...value, description: event.target.value })
          }
        />
      </label>
      <label>
        Format
        <select
          value={value.fileType}
          onChange={(event) => {
            const fileType = event.target.value as "yaml" | "ts";
            // The YAML starter is not a TypeScript workflow; don't submit it
            // under the wrong format. Edited sources are left alone.
            const source =
              fileType === "ts" && value.source === STARTER_FLOW
                ? ""
                : fileType === "yaml" && !value.source.trim()
                  ? STARTER_FLOW
                  : value.source;
            setValue({ ...value, fileType, source });
          }}
        >
          <option value="yaml">YAML workflow</option>
          <option value="ts">TypeScript workflow</option>
        </select>
      </label>
      <label>
        Definition
        <textarea
          className="code-input"
          spellCheck={false}
          rows={18}
          value={value.source}
          onChange={(event) =>
            setValue({ ...value, source: event.target.value })
          }
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="form-actions">
        <button
          className="primary"
          type="submit"
          disabled={busy || !nameValid || !value.source.trim()}
        >
          {busy ? "Saving…" : submitLabel}
        </button>
        <a className="button" href="#/flows">
          Cancel
        </a>
      </div>
    </form>
  );
}

export function NewFlowPage() {
  return (
    <>
      <div className="heading">
        <div>
          <a className="back" href="#/flows">
            ← Back to flows
          </a>
          <h1>New flow</h1>
          <p>
            Define a relayflows workflow. Runs execute on your registered
            workers.
          </p>
        </div>
      </div>
      <FlowForm
        initial={{
          name: "",
          description: "",
          fileType: "yaml",
          source: STARTER_FLOW,
        }}
        submitLabel="Save flow"
        onSubmit={async (value) => {
          const flow = await flowsApi.createFlow({
            name: value.name,
            description: value.description || undefined,
            fileType: value.fileType,
            source: value.source,
          });
          go(`/flows/f/${seg(flow.id)}`);
        }}
      />
    </>
  );
}
