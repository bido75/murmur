// Why the microphone is not available, and the words to explain it. Pure, so it can be
// tested: the app asks the phone or the browser and uses these to say what went wrong.

/** The ways a microphone can be unavailable. */
export type MicProblem = 'blocked' | 'no-device' | 'in-use' | 'no-support' | 'unknown';

/** What the browser or the phone called the problem. */
export function micProblem(name: string | null | undefined): MicProblem {
  switch ((name ?? '').toLowerCase()) {
    case 'notallowederror':
    case 'securityerror':
      return 'blocked';
    case 'notfounderror':
    case 'devicesnotfounderror':
      return 'no-device';
    case 'notreadableerror':
    case 'trackstarterror':
      return 'in-use';
    case 'notsupportederror':
    case 'typenotfound':
    case 'typeerror':
    case 'overconstrainederror':
      return 'no-support';
    default:
      return 'unknown';
  }
}

/**
 * The words to show. On a phone the microphone is turned on in the system Settings; in a
 * browser it is allowed for the site, which is a different place with different words.
 */
export function micMessage(problem: MicProblem, platform: 'web' | 'native'): string {
  if (platform === 'native') {
    switch (problem) {
      case 'no-device':
        return 'No microphone was found on this device.';
      case 'in-use':
        return 'Another app is using the microphone. Close it and try again.';
      case 'blocked':
        return 'Microphone permission is off. Turn it on in Settings to record.';
      default:
        return 'The microphone could not be started. Turn it on in Settings and try again.';
    }
  }
  switch (problem) {
    case 'blocked':
      return 'The browser is not allowed to use the microphone. Open the site permissions next to the address bar, allow the microphone, and try again.';
    case 'no-device':
      return 'No microphone was found. Plug one in, or choose one in the browser settings, and try again.';
    case 'in-use':
      return 'Another app is using the microphone. Close it and try again.';
    case 'no-support':
      return 'This browser cannot record audio. Try a current version of Chrome, Edge, Firefox or Safari.';
    default:
      return 'The microphone could not be started. Allow it in the site permissions and try again.';
  }
}
