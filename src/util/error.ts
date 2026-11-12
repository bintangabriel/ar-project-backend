type ARErrorData = {
  /**
   * status for http status response
   */
  status: number,
  /**
   * code for documentations
   */
  code?: number | string,
  detail?: string,
  [x: string]: any
}

/**
   * AR Error
   */
export class ARError extends Error {
  public data: ARErrorData

  /**
     * AR Error Constructor
     * @param message Error message, also parsed into `{ error: { message: '<msg_string>' } }` in body
     * @param data ARErrorData
     */
  constructor(message: string, data: ARErrorData) {
    super(message)
    this.name = 'ARError'
    this.data = data
  }
}