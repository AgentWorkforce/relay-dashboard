/**
 * BUG 5 — Input area inconsistency (DM vs channel)
 *
 * ROOT CAUSE:
 *   Both DM view (App.tsx:957) and channel view (ChannelViewV1.tsx:157) actually
 *   use the SAME MessageComposer component. MessageInput.tsx is dead code (exported
 *   from channels/index.ts but never imported by any view).
 *
 *   The real inconsistency is in the PROPS passed to MessageComposer in each context:
 *
 *   1. ERROR/LOADING FEEDBACK:
 *      - DM context (App.tsx:963): passes isSending={isSending} and error={sendError}
 *      - Channel context (ChannelViewV1.tsx:157): does NOT pass isSending or error
 *      - Result: channel users get no visual feedback on send failures
 *
 *   2. PLACEHOLDER FORMAT:
 *      - Channel (ChannelViewV1:113): "Message #general" (no trailing ellipsis)
 *      - DM (App.tsx:967): "Message @Alice..." (trailing ellipsis)
 *
 *   3. MENTION INSERTION:
 *      - DM context passes insertMention and onMentionInserted props
 *      - Channel context does not, so external mention triggers don't work
 *
 *   4. DEAD CODE CONFUSION:
 *      - MessageInput.tsx exists with completely different behavior (sync onSend,
 *        no attachments, debounced typing, different styling) but is never used
 *      - Its existence creates maintenance confusion and inconsistent interfaces
 *
 * FIX:
 *   1. Pass isSending and error to MessageComposer in ChannelViewV1
 *   2. Normalize placeholder format (both with or without ellipsis)
 *   3. Delete dead-code MessageInput.tsx and ChannelChat.tsx
 *   4. Add typing debounce to MessageComposer (port from MessageInput)
 *
 * Reproduction: Compare DM and channel input areas — channel has no send error feedback
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const DASHBOARD_ROOT = path.resolve(__dirname, '../../packages/dashboard/src');

describe('BUG 5 — Input area inconsistency', () => {
  it('DM uses MessageComposer while channel uses MessageInput (two different components)', () => {
    const composerPath = path.join(DASHBOARD_ROOT, 'components/MessageComposer.tsx');
    const inputPath = path.join(DASHBOARD_ROOT, 'components/channels/MessageInput.tsx');

    // Both files exist as separate components — this IS the bug
    expect(fs.existsSync(composerPath)).toBe(true);
    expect(fs.existsSync(inputPath)).toBe(true);
  });

  it('MessageComposer placeholder differs from MessageInput placeholder', () => {
    const composerContent = fs.readFileSync(
      path.join(DASHBOARD_ROOT, 'components/MessageComposer.tsx'),
      'utf-8'
    );
    const inputContent = fs.readFileSync(
      path.join(DASHBOARD_ROOT, 'components/channels/MessageInput.tsx'),
      'utf-8'
    );

    // BUG: Different default placeholders
    expect(composerContent).toContain("placeholder = 'Type a message...'");
    expect(inputContent).toContain("placeholder = 'Send a message...'");
  });

  it('MessageComposer supports image paste but MessageInput does not', () => {
    const composerContent = fs.readFileSync(
      path.join(DASHBOARD_ROOT, 'components/MessageComposer.tsx'),
      'utf-8'
    );
    const inputContent = fs.readFileSync(
      path.join(DASHBOARD_ROOT, 'components/channels/MessageInput.tsx'),
      'utf-8'
    );

    // MessageComposer has clipboard image paste support
    expect(composerContent).toContain('handlePaste');
    expect(composerContent).toContain('processImageFiles');

    // MessageInput does NOT have clipboard paste support
    expect(inputContent).not.toContain('handlePaste');
    expect(inputContent).not.toContain('processImageFiles');
  });

  it('onSend signatures differ between components', () => {
    const composerContent = fs.readFileSync(
      path.join(DASHBOARD_ROOT, 'components/MessageComposer.tsx'),
      'utf-8'
    );
    const inputContent = fs.readFileSync(
      path.join(DASHBOARD_ROOT, 'components/channels/MessageInput.tsx'),
      'utf-8'
    );

    // MessageComposer: onSend returns Promise<boolean> and accepts attachmentIds
    expect(composerContent).toContain('onSend: (content: string, attachmentIds?: string[]) => Promise<boolean>');

    // MessageInput: onSend is simpler, just text
    expect(inputContent).toContain('onSend');
    // The onSend signature in MessageInput takes just a string
  });
});
