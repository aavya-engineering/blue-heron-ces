// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useCallback, useEffect, useRef, useState } from 'react';

export type EventStreamStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

/** The part of EventSource the hook uses (lets tests and non-browser hosts inject one). */
export interface EventSourceLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export interface UseEventStreamOptions<T> {
  /** Called once per parsed `message` event. */
  onMessage: (data: T) => void;
  /** Called on a stream error, after the stream is closed. */
  onError?: () => void;
  /** Default JSON.parse; an event whose data does not parse is dropped (legacy console behaviour). */
  parse?: (raw: string) => T;
  createEventSource?: EventSourceFactory;
}

export interface EventStream {
  status: EventStreamStatus;
  close: () => void;
}

const defaultFactory: EventSourceFactory = (url) => new EventSource(url);

/**
 * Opens an SSE stream for `url` (null = no stream) the way the legacy console does:
 * one stream per URL, JSON `message` events, and on error the stream is closed, not retried.
 * Changing the URL or unmounting closes the current stream.
 */
export function useEventStream<T = unknown>(url: string | null, options: UseEventStreamOptions<T>): EventStream {
  const [status, setStatus] = useState<EventStreamStatus>(url ? 'connecting' : 'idle');
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const sourceRef = useRef<EventSourceLike | null>(null);

  useEffect(() => {
    if (!url) {
      setStatus('idle');
      return undefined;
    }
    const factory = optionsRef.current.createEventSource ?? defaultFactory;
    const source = factory(url);
    sourceRef.current = source;
    setStatus('connecting');

    source.onopen = () => setStatus('open');
    source.onmessage = (event) => {
      const parse = optionsRef.current.parse ?? ((raw: string) => JSON.parse(raw) as T);
      let data: T;
      try {
        data = parse(String(event.data));
      } catch {
        return;
      }
      optionsRef.current.onMessage(data);
    };
    source.onerror = () => {
      source.close();
      sourceRef.current = null;
      setStatus('error');
      optionsRef.current.onError?.();
    };

    return () => {
      source.close();
      if (sourceRef.current === source) sourceRef.current = null;
    };
  }, [url]);

  const close = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
      setStatus('closed');
    }
  }, []);

  return { status, close };
}
