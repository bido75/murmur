// Why the microphone is not available, and the words to explain it. Pure, so it can be
// tested: the app asks the phone or the browser and uses these to say what went wrong.

/** The ways a microphone can be unavailable. */
export type MicProblem = 'blocked' | 'no-device' | 'in-use' | 'no-support' | 'unknown';

/**
 * The words to use when the page itself is the problem.
 *
 * A browser only hands a page a microphone on a **secure** page: https, or
 * `localhost`. On a plain address on the network — `http://192.168.1.5:8090` — the
 * browser withholds the microphone entirely, so `navigator.mediaDevices` is not even
 * there. Saying "try another browser" for that sends people down the wrong road,
 * because every browser behaves the same way.
 */
export function insecurePageMessage(): string {
  return 'This page is not secure, so the browser will not give it a microphone. Open the app over https, or open it in the Expo Go app on your phone.';
}

/**
 * The words to use when the browser itself cannot record.
 */
export function noBrowserSupportMessage(): string {
  return 'This browser cannot record audio. Try a current version of Chrome, Edge, Firefox or Safari.';
}

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
