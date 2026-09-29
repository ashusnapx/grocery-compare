'use client';

import { LockSimpleIcon, ShareNetworkIcon, SparkleIcon, TrashIcon, XIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { completeRow, itemFor, parseRow, UNITS, type GeoLocation, type ListRow, type Unit } from '@gc/engine';
import { toast } from 'sonner';
import { itemLabel, track } from '@/lib/analytics';
import { listLink, shareOrCopy } from '@/lib/share';
import { AddItem } from './AddItem';
import { PasteDialog } from './PasteDialog';

const UNIT_LABEL: Record<Unit, string> = { g: 'g', kg: 'kg', ml: 'ml', L: 'L', pcs: 'pcs', dozen: 'dozen', pack: 'pack' };

const QUICK = ['Milk 1 L', 'Bread', 'Eggs 12', 'Pyaz 1 kg', 'Tamatar 1 kg', 'Amul butter 500 g', 'Atta 5 kg', 'Toor dal 1 kg'];

export const SAMPLE_LIST = [
  'Aashirvaad atta 5 kg',
  'Toor dal 1 kg',
  'Amul butter 500 g',
  'Milk 2 L',
  'Eggs 12',
  'Pyaz 2 kg',
  'Tamatar 1 kg',
  'Fortune sunflower oil 1 L',
  'Tata salt 1 kg',
  'Maggi 4 pack',
];

let seq = 0;
export function newRowId(): string {
  seq += 1;
  return `row-${Date.now().toString(36)}-${seq}`;
}

export function rowFromText(text: string): ListRow {
  const done = completeRow(text);
  return { id: newRowId(), text: done.text, amount: done.amount, unit: done.unit, anyBrand: false };
}

interface Props {
  rows: ListRow[];
  onChange: (rows: ListRow[]) => void;
  location: GeoLocation | null;
  /** A whole list arrived at once (pasted): price it straight away. */
  onBulkAdd: (rows: ListRow[]) => void;
}

export function ListBuilder({ rows, onChange, location, onBulkAdd }: Props) {
  const update = (id: string, patch: Partial<ListRow>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => {
    const gone = rows.find((r) => r.id === id);
    if (gone) track('remove_from_list', { item: itemLabel(gone.text), list_size: rows.length - 1 });
    onChange(rows.filter((r) => r.id !== id));
  };
  const add = (added: ListRow[]) => onChange([...rows, ...added]);
  const addMany = (added: Omit<ListRow, 'id'>[]) => {
    track('add_to_list', { method: 'paste', count: added.length, list_size: rows.length + added.length });
    const next = [...rows, ...added.map((x) => ({ ...x, id: newRowId() }))];
    onChange(next);
    onBulkAdd(next);
  };

  return (
    <section className="rounded-2xl border border-line bg-card p-4 shadow-card sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight whitespace-nowrap sm:text-xl">Your jhola</h2>
        <div className="flex items-center gap-1">
          {rows.length > 0 && (
            <>
              <button
                type="button"
                onClick={async () => {
                  const r = await shareOrCopy({ title: 'My jhola list', text: 'My grocery list — see where it’s cheapest on jhola:', url: listLink(rows) });
                  if (r === 'copied') toast('List link copied — send it to the family group 📋');
                }}
                aria-label="Share list"
                title="Share list"
                className="btn-ghost size-9"
              >
                <ShareNetworkIcon size={18} />
              </button>
              <button
                type="button"
                onClick={() => {
                  track('clear_list', { count: rows.length });
                  onChange([]);
                }}
                aria-label="Clear list"
                title="Clear list"
                className="btn-ghost size-9"
              >
                <TrashIcon size={18} />
              </button>
            </>
          )}
          <PasteDialog onRows={addMany} />
        </div>
      </div>

      <AddItem
        location={location}
        onAddMany={addMany}
        onAdd={(text, picked) =>
          add([picked ? { ...picked.row, id: newRowId(), ...(picked.imageUrl ? { imageUrl: picked.imageUrl } : {}) } : rowFromText(text)])
        }
      />

      <ul data-testid="list-rows" className="mt-2 flex flex-col divide-y divide-line empty:hidden">
        <AnimatePresence initial={false}>
          {rows.map((row) => (
            <motion.li
              key={row.id}
              layout
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <RowEditor row={row} onUpdate={(p) => update(row.id, p)} onRemove={() => remove(row.id)} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {rows.length === 0 && (
        // One swipeable row on phones, wrapped on wider screens.
        <div
          aria-label="Quick add"
          role="group"
          className="scrollbar-none -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
        >
          <button
            type="button"
            data-testid="sample-list"
            onClick={() => {
              track('add_to_list', { method: 'sample', count: SAMPLE_LIST.length, list_size: rows.length + SAMPLE_LIST.length });
              add(SAMPLE_LIST.map(rowFromText));
            }}
            title="Fill in a full sample jhola"
            className="press flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-good-line bg-good-soft px-3 text-sm font-medium whitespace-nowrap text-good"
          >
            <SparkleIcon size={14} weight="fill" /> Try a sample
          </button>
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => {
                track('add_to_list', { method: 'quick_add', item: itemLabel(q), list_size: rows.length + 1 });
                add([rowFromText(q)]);
              }}
              className="press flex h-8 shrink-0 items-center rounded-full border border-line bg-card px-3 text-sm whitespace-nowrap hover:bg-soft"
            >
              {itemFor(q)?.emoji ?? '🛒'} {q}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function RowEditor({ row, onUpdate, onRemove }: { row: ListRow; onUpdate: (p: Partial<ListRow>) => void; onRemove: () => void }) {
  const parsed = useMemo(() => parseRow(row), [row]);
  const emoji = useMemo(() => itemFor(row.text)?.emoji ?? '🛒', [row.text]);
  const [draft, setDraft] = useState(row.text);

  const commit = () => {
    const text = draft.trim();
    if (!text) {
      setDraft(row.text);
      return;
    }
    // "atta 5kg" typed into the name moves the amount into its own fields.
    const done = completeRow(text);
    const typedAmount = done.text !== text;
    setDraft(done.text);
    onUpdate(typedAmount ? { text: done.text, amount: done.amount, unit: done.unit } : { text });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 py-2 sm:flex-nowrap sm:gap-2.5">
      {row.imageUrl ? (
        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-white" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={row.imageUrl} alt="" referrerPolicy="no-referrer" className="size-full object-contain p-0.5" />
        </span>
      ) : (
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-soft text-lg" aria-hidden>
          {emoji}
        </span>
      )}
      {/* As wide as its text (an invisible copy sets the width): a short name keeps the
          controls on its line, a long one pushes them below it on phones. */}
      <span className="grid min-w-0 flex-auto">
        <span aria-hidden className="invisible col-start-1 row-start-1 overflow-hidden px-1.5 py-1.5 font-medium whitespace-pre">
          {draft}{' '}
        </span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          aria-label="Item"
          size={1}
          className="col-start-1 row-start-1 w-full min-w-0 rounded-md bg-transparent px-1.5 py-1.5 font-medium outline-none transition-colors hover:bg-soft focus:bg-soft"
        />
      </span>
      <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
        {parsed.brand && (
          <button
            type="button"
            onClick={() => {
              track('brand_toggle', { item: itemLabel(row.text), brand_locked: row.anyBrand });
              onUpdate({ anyBrand: !row.anyBrand });
            }}
            title={row.anyBrand ? 'Any brand counts — tap to stick to this brand' : `Only ${parsed.brand} — tap to allow any brand`}
            className="press flex h-7 items-center gap-1 rounded-full border border-line px-2.5 text-xs font-medium whitespace-nowrap text-muted hover:bg-soft hover:text-fg"
          >
            {row.anyBrand ? (
              <>
                <SparkleIcon size={12} weight="fill" /> any brand
              </>
            ) : (
              <>
                <LockSimpleIcon size={12} weight="fill" /> {parsed.brand}
              </>
            )}
          </button>
        )}
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={row.amount}
          onChange={(e) => onUpdate({ amount: Math.max(0, Number(e.target.value) || 0) })}
          aria-label="Quantity"
          className="no-spin h-8 w-12 rounded-lg border border-line bg-card px-1 text-center text-sm tabular-nums outline-none transition-[border-color,box-shadow] focus:border-focus focus:ring-3 focus:ring-focus/15 sm:w-16 sm:px-2"
        />
        <select
          value={row.unit}
          onChange={(e) => onUpdate({ unit: e.target.value as Unit })}
          aria-label="Unit"
          className="h-8 cursor-pointer rounded-lg border border-line bg-card pr-1 pl-1.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-focus focus:ring-3 focus:ring-focus/15 sm:px-2"
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {UNIT_LABEL[u]}
            </option>
          ))}
        </select>
        <button type="button" onClick={onRemove} aria-label={`Remove ${row.text}`} className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-bad-soft hover:text-bad">
          <XIcon size={16} />
        </button>
      </div>
    </div>
  );
}
