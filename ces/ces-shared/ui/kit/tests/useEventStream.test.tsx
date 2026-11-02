// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useEventStream, type EventSourceLike } from '../src';

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.(new Event('open'));
  }
  emit(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
  fail() {
    this.onerror?.(new Event('error'));
  }
}

const factory = (url: string) => new FakeEventSource(url);

afterEach(() => {
  cleanup();
  FakeEventSource.instances = [];
});

describe('useEventStream', () => {
  it('stays idle and opens nothing when the url is null', () => {
    const { result } = renderHook(() => useEventStream(null, { onMessage: vi.fn(), createEventSource: factory }));
    expect(result.current.status).toBe('idle');
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('opens one stream, reports open, and delivers parsed JSON messages', () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() =>
      useEventStream('/api/connect?tenant=dev', { onMessage, createEventSource: factory }),
    );
    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0];
    expect(source.url).toBe('/api/connect?tenant=dev');
    expect(result.current.status).toBe('connecting');
    act(() => source.open());
    expect(result.current.status).toBe('open');
    act(() => source.emit('{"type":"prereq_check","installed":true}'));
    expect(onMessage).toHaveBeenCalledWith({ type: 'prereq_check', installed: true });
  });

  it('drops events whose data does not parse, as the legacy console does', () => {
    const onMessage = vi.fn();
    renderHook(() => useEventStream('/api/execute', { onMessage, createEventSource: factory }));
    act(() => FakeEventSource.instances[0].emit('not json'));
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('closes the stream on error without retrying and calls onError', () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useEventStream('/api/assess', { onMessage: vi.fn(), onError, createEventSource: factory }),
    );
    const source = FakeEventSource.instances[0];
    act(() => source.fail());
    expect(source.closed).toBe(true);
    expect(result.current.status).toBe('error');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('close() closes the stream and reports closed', () => {
    const { result } = renderHook(() => useEventStream('/api/baseline', { onMessage: vi.fn(), createEventSource: factory }));
    act(() => result.current.close());
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(result.current.status).toBe('closed');
  });

  it('closes the old stream when the url changes, and on unmount', () => {
    const { rerender, unmount } = renderHook(
      ({ url }: { url: string }) => useEventStream(url, { onMessage: vi.fn(), createEventSource: factory }),
      { initialProps: { url: '/api/preflight?tenant=a' } },
    );
    rerender({ url: '/api/preflight?tenant=b' });
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[0].closed).toBe(true);
    unmount();
    expect(FakeEventSource.instances[1].closed).toBe(true);
  });

  it('uses the latest onMessage without reopening the stream', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ onMessage }: { onMessage: (d: unknown) => void }) =>
        useEventStream('/api/execute', { onMessage, createEventSource: factory }),
      { initialProps: { onMessage: first } },
    );
    rerender({ onMessage: second });
    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => FakeEventSource.instances[0].emit('{"n":1}'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ n: 1 });
  });
});
