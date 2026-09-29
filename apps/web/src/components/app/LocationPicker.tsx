'use client';

import { CaretDownIcon, CrosshairIcon, MapPinIcon, SpinnerGapIcon, XIcon } from '@phosphor-icons/react';
import { Dialog } from 'radix-ui';
import { useState } from 'react';
import { toast } from 'sonner';
import type { GeoLocation } from '@gc/engine';
import { gpsLocation, locate, type LocationSource } from '@/lib/geo';

interface Props {
  location: GeoLocation | null;
  onChange: (loc: GeoLocation, source: LocationSource) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A rough place (pincode centre or the network's guess): shown with "≈". */
  approximate?: boolean;
}

export function LocationPicker({ location, onChange, open, onOpenChange: setOpen, approximate = false }: Props) {
  const rough = approximate || !!location?.approximate;
  const place = location ? `${location.pincode}${location.label ? ` · ${location.label}` : ''}` : '';
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState<'pin' | 'gps' | null>(null);

  const submitPin = async () => {
    if (!/^\d{6}$/.test(pin)) {
      toast.error('Pincode = 6 digits, bestie');
      return;
    }
    setBusy('pin');
    try {
      onChange(await locate({ pincode: pin }), 'manual');
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not find that pincode');
    } finally {
      setBusy(null);
    }
  };

  const useGps = async () => {
    setBusy('gps');
    const found = await gpsLocation();
    setBusy(null);
    if (!found) {
      toast.error('Couldn’t get your location — a pincode works too.');
      return;
    }
    onChange(found, 'gps');
    setOpen(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          data-testid="location"
          aria-label={location ? `Deliver to ${place}${rough ? ' (approximate)' : ''}` : 'Set delivery location'}
          title={rough ? 'Approximate — use GPS for exact dark-store prices' : undefined}
          className="btn-secondary max-w-full justify-start gap-1.5 rounded-full py-1.5 pr-2.5 pl-3 text-left text-sm"
        >
          <MapPinIcon size={16} weight="fill" className="shrink-0 text-good" />
          <span className="min-w-0 truncate font-medium">
            {location ? (
              <>
                {rough && <span aria-hidden>≈ </span>}
                <span className="tabular-nums">{location.pincode}</span>
                {location.label ? <span className="font-normal text-muted"> · {location.label}</span> : null}
              </>
            ) : (
              'Set delivery location'
            )}
          </span>
          <CaretDownIcon size={13} weight="bold" className="shrink-0 text-muted" aria-hidden />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 dark:bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-card p-6 shadow-pop data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-xl font-semibold tracking-tight">Where do we deliver?</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted">Prices depend on your nearest store.</Dialog.Description>
            </div>
            <Dialog.Close className="btn-ghost -mt-1 -mr-2 size-8 shrink-0" aria-label="Close">
              <XIcon size={16} />
            </Dialog.Close>
          </div>

          <button
            type="button"
            onClick={() => void useGps()}
            disabled={busy !== null}
            className="btn-primary mt-5 h-11 w-full px-4 text-base"
          >
            {busy === 'gps' ? <SpinnerGapIcon size={18} className="animate-spin" /> : <CrosshairIcon size={18} weight="bold" />}
            Use my exact location
          </button>

          <div className="my-4 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submitPin();
            }}
          >
            <input
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="6-digit pincode"
              aria-label="Pincode"
              className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-card px-3.5 text-base tracking-[0.15em] tabular-nums outline-none transition-[border-color,box-shadow] placeholder:tracking-normal placeholder:text-muted focus:border-focus focus:ring-4 focus:ring-focus/15"
            />
            <button
              type="submit"
              disabled={busy !== null}
              className="btn-secondary h-11 px-5 text-base"
            >
              {busy === 'pin' ? <SpinnerGapIcon size={18} className="animate-spin" /> : 'Go'}
            </button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
