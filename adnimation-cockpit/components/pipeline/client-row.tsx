'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/hud/tag';
import { Num } from '@/components/num';
import { PipelineClientForm } from './client-form';
import { TouchForm } from './touch-form';
import { IntegrationChecklist } from './integration-checklist';
import { CloseDeal } from './close-deal';
import { looksDone } from '@/lib/pipeline/integration';
import { CLIENT_TYPE_LABEL, QUIET_DAYS, STAGE_LABEL, TEMPERATURE_LABEL } from '@/lib/pipeline/types';
import type { PipelineRow } from '@/lib/pipeline/service';
import { fmtDate, fmtMoney } from '@/lib/utils';

const TEMP_TONE = { hot: 'critical', warm: 'warning', cold: 'outline' } as const;

export interface Touch {
  kind: string;
  summary: string;
  happenedAt: Date;
}

/**
 * One client in the pipeline: its classifications, what is owed on it, and the
 * two things the CEO does to it — log a conversation, or change what it is.
 * Both open in place; nothing here navigates away, because working the list is
 * a single pass down it.
 */
export function PipelineClientRow({
  client,
  owners,
  touches,
}: {
  client: PipelineRow;
  owners: { id: string; name: string }[];
  touches: Touch[];
}) {
  const [editing, setEditing] = useState(false);
  const [logging, setLogging] = useState(false);
  // Open by default once the deal has reached the stage the steps are about:
  // that is the moment the question stops being "will this happen" and starts
  // being "what is left".
  const [showSteps, setShowSteps] = useState(
    client.stage === 'integration' && client.closedAt === null,
  );

  const quiet = client.quietDays === null || client.quietDays >= QUIET_DAYS;
  const verdict = looksDone(client.stage, client.integration);

  return (
    <li className="border-t border-line px-[18px] py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {/* The name is the way in. Looking for an EDIT button to change a
                deal is one indirection too many on a list he works down. */}
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="text-start font-cond text-[17px] leading-none text-neutral-900 hover:text-accent"
              title="Open this deal and change anything on it"
            >
              {client.name}
            </button>
            <Tag tone="outline">{CLIENT_TYPE_LABEL[client.clientType]}</Tag>
            <Tag tone={TEMP_TONE[client.temperature]}>{TEMPERATURE_LABEL[client.temperature]}</Tag>
            <Tag tone="neutral">{STAGE_LABEL[client.stage]}</Tag>
            {client.stage === 'integration' && client.closedAt === null ? (
              <Tag tone={client.integration.complete ? 'ok' : 'watch'}>
                <Num>{client.integration.done}</Num>/<Num>{client.integration.total}</Num> LIVE
              </Tag>
            ) : null}
            {verdict.done && client.closedAt === null ? (
              <Tag tone="ok" title={verdict.why}>Looks finished</Tag>
            ) : null}
          </div>

          <p className="hud-label mt-1 text-[11px]">
            {[
              client.domain,
              client.ownerName ? `OWNER ${client.ownerName}` : 'OWNER ME',
              client.source,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>

          <p className="mt-1.5 text-[13px] text-neutral-700">
            {client.nextStep ? (
              <>
                <span className="hud-label me-1.5 text-[11px]">Next</span>
                {client.nextStep}
                {client.nextStepDate ? (
                  <span
                    className={
                      client.stepOverdue ? 'ms-1.5 text-sev-critical' : 'ms-1.5 text-neutral-500'
                    }
                  >
                    <Num>{fmtDate(new Date(`${client.nextStepDate}T00:00:00Z`))}</Num>
                    {client.stepOverdue ? ' · DUE' : ''}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-neutral-500">No next step set.</span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-start gap-5">
          <div className="text-end">
            <span className="hud-label block text-[11px]">VALUE / MO</span>
            <span className="font-cond text-[19px] leading-none text-neutral-900">
              <Num>{client.valueCents != null ? fmtMoney(client.valueCents) : '—'}</Num>
            </span>
            {client.probability != null ? (
              <span className="mt-0.5 block font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
                <Num>{client.probability}%</Num>
              </span>
            ) : null}
          </div>

          <div className="text-end">
            <span className="hud-label block text-[11px]">Last touch</span>
            <span
              className={`font-cond text-[19px] leading-none ${
                quiet ? 'text-sev-warning' : 'text-neutral-900'
              }`}
            >
              <Num>{client.quietDays === null ? 'NEVER' : `${client.quietDays}d`}</Num>
            </span>
            <span className="mt-0.5 block font-semi text-[11.5px] tracking-[0.12em] text-neutral-500">
              <Num>{client.touches}</Num> Logged
            </span>
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" size="xs" variant="outline" onClick={() => setLogging((v) => !v)}>
          {logging ? 'CLOSE' : 'LOG TOUCH'}
        </Button>
        <Button type="button" size="xs" variant={editing ? 'default' : 'ghost'} onClick={() => setEditing((v) => !v)}>
          {editing ? 'CLOSE' : 'EDIT EVERYTHING'}
        </Button>
        <Button
          type="button"
          size="xs"
          variant={showSteps ? 'default' : 'ghost'}
          onClick={() => setShowSteps((v) => !v)}
          title="The steps between signed and earning"
        >
          {showSteps ? 'HIDE STEPS' : `GOING LIVE ${client.integration.done}/${client.integration.total}`}
        </Button>
        <CloseDeal
          clientId={client.id}
          closed={client.closedAt !== null}
          outcome={client.closeOutcome}
          note={client.closeNote}
          suggestion={verdict.done ? verdict.why : ''}
        />
      </div>

      {showSteps ? <IntegrationChecklist clientId={client.id} progress={client.integration} /> : null}

      {logging ? (
        <div className="mt-2 border border-line p-2">
          <TouchForm clientId={client.id} onDone={() => setLogging(false)} />
        </div>
      ) : null}

      {editing ? (
        <div className="mt-2 border border-line p-2">
          <PipelineClientForm owners={owners} client={client} onDone={() => setEditing(false)} />
        </div>
      ) : null}

      {touches.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {touches.map((t, i) => (
            <li key={i} className="text-[12px] text-neutral-600">
              <span className="hud-label me-1.5 text-[11px]">{t.kind.toUpperCase()}</span>
              <span className="me-1.5 text-neutral-500">
                <Num>{fmtDate(t.happenedAt)}</Num>
              </span>
              {t.summary}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
