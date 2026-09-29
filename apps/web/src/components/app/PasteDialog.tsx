'use client';

import { ClipboardTextIcon, XIcon } from '@phosphor-icons/react';
import { Dialog } from 'radix-ui';
import { useMemo, useState } from 'react';
import { parsePastedList, type ListRow } from '@gc/engine';

const EXAMPLE = `1. Atta - 5 kg
- toor dal 1kg
• pyaz 2 kg
eggs 12, amul butter 500g
milk 1L x 2`;

export function PasteDialog({ onRows }: { onRows: (rows: Omit<ListRow, 'id'>[]) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const parsed = useMemo(() => parsePastedList(text), [text]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Paste a list"
          title="Paste a list from WhatsApp or Notes"
          className="btn-secondary ml-1 h-9 gap-1.5 px-3 text-sm"
        >
          <ClipboardTextIcon size={16} /> Paste
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 dark:bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(94vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-card p-6 shadow-pop data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-xl font-semibold tracking-tight">Paste your list</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted">From WhatsApp or Notes — one item per line.</Dialog.Description>
            </div>
            <Dialog.Close className="btn-ghost -mt-1 -mr-2 size-8 shrink-0" aria-label="Close">
              <XIcon size={16} />
            </Dialog.Close>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={EXAMPLE}
            rows={7}
            className="mt-4 w-full resize-none rounded-lg border border-line bg-card p-3 text-sm leading-relaxed outline-none transition-[border-color,box-shadow] placeholder:text-muted focus:border-focus focus:ring-4 focus:ring-focus/15"
          />
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-sm text-muted">
              {parsed.length ? `${parsed.length} item${parsed.length === 1 ? '' : 's'} spotted` : 'Waiting for your list…'}
            </span>
            <button
              type="button"
              disabled={!parsed.length}
              onClick={() => {
                onRows(parsed);
                setText('');
                setOpen(false);
              }}
              className="btn-primary h-10 px-4 text-sm"
            >
              Add {parsed.length || ''} to jhola
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
