import type { z } from 'zod'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
  }
}

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value)
  if (!r.success) throw new HttpError(400, 'invalid_request')
  return r.data
}
