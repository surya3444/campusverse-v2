'use client';

import { Button, FormModal, ModalField } from '@campusverse/ui';
import { useMutation } from '@tanstack/react-query';
import { Siren } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { fieldInput } from '../common/custom-fields';
import { errorText, t } from './shared';

const s = t.sos;

/** The red button on the bus (driver or attendant): tells the in-charge at once. */
export function SosButton({
  institutionId,
  tripId,
  where,
  onSent,
  large = false,
}: {
  institutionId: string;
  tripId: string;
  /** The bus's last known position, sent with the SOS. */
  where: () => { lat: number; lng: number } | null;
  onSent: () => void;
  large?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const send = useMutation({
    mutationFn: () => {
      const at = where();
      return api.post(`/transport/trips/${tripId}/sos`, {
        institutionId,
        ...(note.trim() ? { note } : {}),
        ...(at ? { at } : {}),
      });
    },
    onSuccess: () => {
      setOpen(false);
      setNote('');
      onSent();
    },
  });
  return (
    <>
      <Button
        variant="danger"
        className={large ? 'min-h-14 w-full text-title' : undefined}
        onClick={() => setOpen(true)}
      >
        <Siren aria-hidden className={large ? 'size-6' : 'size-4'} />
        {s.button}
      </Button>
      {open && (
        <FormModal
          title={s.title}
          description={s.body}
          submitLabel={s.send}
          cancelLabel={t.cancel}
          pending={send.isPending}
          error={send.error ? errorText(send.error) : null}
          tone="danger"
          size="md"
          onClose={() => setOpen(false)}
          onSubmit={() => send.mutate()}
        >
          <ModalField label={s.note} wide>
            <textarea
              className={fieldInput}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </ModalField>
        </FormModal>
      )}
    </>
  );
}
