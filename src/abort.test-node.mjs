/* global AbortSignal, AbortController */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anySignal } from './abort.ts';

test('combined cancellation works without AbortSignal.any', () => {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
  Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
  try {
    const first = new AbortController();
    const second = new AbortController();
    const combined = anySignal([first.signal, second.signal]);
    assert.equal(combined.aborted, false);
    second.abort('navigation');
    assert.equal(combined.aborted, true);
    assert.equal(combined.reason, 'navigation');
    first.abort('later');
    assert.equal(combined.reason, 'navigation');
    assert.equal(anySignal([first.signal]).reason, 'later');
    assert.equal(anySignal([]).aborted, false);
  } finally {
    Object.defineProperty(AbortSignal, 'any', descriptor);
  }
});
