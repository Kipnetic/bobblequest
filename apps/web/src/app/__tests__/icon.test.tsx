import { describe, expect, test, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock next/og before importing the icon module so ImageResponse is replaced
// with a lightweight spy that captures the JSX node passed to it.
// ---------------------------------------------------------------------------
vi.mock('next/og', () => ({
  // Vitest 4 mocks called with `new` need a constructable implementation.
  ImageResponse: vi.fn(function (this: { node: unknown }, node: unknown) {
    this.node = node
  }),
}))

import { ImageResponse } from 'next/og'
import Icon, { contentType, size } from '../icon.js'

const MockImageResponse = vi.mocked(ImageResponse)

describe('icon.tsx exports', () => {
  test('size is { width: 32, height: 32 }', () => {
    expect(size).toEqual({ width: 32, height: 32 })
  })

  test('contentType is "image/png"', () => {
    expect(contentType).toBe('image/png')
  })
})

describe('Icon() default export', () => {
  test('invokes ImageResponse and returns its result', () => {
    const result = Icon()
    expect(MockImageResponse).toHaveBeenCalledTimes(1)
    // The mock returns { node } — verify the return value is that object
    expect(result).toHaveProperty('node')
  })

  test('passes a JSX node as the first argument to ImageResponse', () => {
    Icon()
    const [jsxNode] = MockImageResponse.mock.calls[0]!
    // A React element is a plain object with a `type` field
    expect(jsxNode).toBeDefined()
    expect(typeof jsxNode).toBe('object')
    expect(jsxNode).not.toBeNull()
  })

  test('passes size options as the second argument to ImageResponse', () => {
    Icon()
    const [, options] = MockImageResponse.mock.calls[0]!
    expect(options).toEqual({ width: 32, height: 32 })
  })
})
