export class BffHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'BffHttpError'
  }
}

export function isBffHttpError(error: unknown): error is BffHttpError {
  return error instanceof BffHttpError
}
