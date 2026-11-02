// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-31b: the legacy dashboard "Assessment Timeline" (loadTimeline / renderTimeline /
// addTimelineEvent): the last 20 events newest first, and a custom event (title + date) added
// with POST /api/timeline/events { title, date, type: 'custom' }.

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { eoApi } from '../../api/eo';
import type { TimelineEvent } from '../../api/types';
import { Card, Field, Notice, useAction } from '../../components/common';

const TYPE_LABEL: Record<string, string> = { assessment: 'Assessment', certification: 'Certification', poam_deadline: 'POA&M deadline', custom: 'Custom' };

/** Legacy order: the last 20 events, newest last in storage, shown newest first. */
export function recentEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events.slice(-20).reverse();
}

export function TimelineCard({ tenant }: { tenant: string }) {
  const qc = useQueryClient();
  const tl = useQuery({ queryKey: ['timeline', tenant], queryFn: () => eoApi.timeline(tenant), retry: false });
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const add = useAction();
  const events = recentEvents(tl.data?.events ?? []);
  return (
    <Card title="Assessment timeline" id="eo-timeline-card"
      actions={<button type="button" className="btn btn-ghost btn-small" id="timelineRefresh" onClick={() => void tl.refetch()}>Refresh</button>}>
      {tl.isError ? <Notice kind="error">The timeline could not be loaded.</Notice> : null}
      {events.length === 0 ? <p className="eo-muted" id="timelineEmpty">No timeline events yet.</p> : (
        <ol className="eo-timeline" id="timelineContent">
          {events.map((e, i) => (
            <li key={e.eventId ?? `${e.date}-${i}`} className={`eo-timeline-${e.type}`}>
              <span className="eo-timeline-type">{TYPE_LABEL[e.type] ?? e.type}</span>
              <strong>{e.title}</strong>
              <span className="eo-muted">{`${new Date(e.date).toLocaleDateString()}${e.detail ? ` — ${e.detail}` : ''}`}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="eo-row">
        <Field label="Event title"><input id="timelineTitle" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Event date"><input id="timelineDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <button type="button" className="btn btn-primary btn-small" id="timelineAddBtn" disabled={!title.trim() || !date || add.busy}
          onClick={() => void add.run(async () => {
            const r = await eoApi.addTimelineEvent(tenant, { title: title.trim(), date });
            setTitle(''); setDate('');
            await qc.invalidateQueries({ queryKey: ['timeline', tenant] });
            return r;
          }, () => 'Event added.')}>
          Add event
        </button>
      </div>
      {add.message ? <Notice kind={add.message.kind}>{add.message.text}</Notice> : null}
    </Card>
  );
}
