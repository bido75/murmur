// What the app shows when a recording could not be made. The real reason is in the
// function logs; this is the line a person sees.

/**
 * Turn a server-side failure into words someone can act on. A missing server setting is
 * the operator's to fix, so the app says that plainly instead of naming a secret.
 */
export function userFacingError(message: string): string {
  if (/^Missing secret /.test(message)) {
    return 'The notes could not be made: this server is not set up for transcription yet.';
  }
  return message;
}
