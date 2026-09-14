# Accessibility testing

Run `pnpm test:a11y` against every release candidate. It scans both playgrounds
with axe before and after an error, and exercises toggle and hold-to-talk with
keyboard input only.

Automated checks do not replace assistive-technology testing. The beta-exit
baseline requires a short manual pass with VoiceOver and current Safari on
macOS. Record the candidate SHA, date, tester, operating system, browser,
assistive technology and version, input device, result, and evidence URL for
every manual run below. A blank row is not a pass.

| Platform            | Assistive technology                 | Beta status                                 | Result and evidence |
| ------------------- | ------------------------------------ | ------------------------------------------- | ------------------- |
| macOS               | VoiceOver, current Safari            | Required before beta exit; not yet verified |                     |
| iPhone, current iOS | VoiceOver, Safari                    | Optional beta evidence                      |                     |
| iPad, current iOS   | VoiceOver, Safari                    | Optional beta evidence                      |                     |
| Windows             | NVDA or JAWS, current Chrome or Edge | Optional beta evidence                      |                     |

For the beta-exit macOS run, complete this short flow with VoiceOver and the
keyboard only in current Safari:

- Navigate to a voice-enabled field and its trigger. Confirm both have useful
  names and visible focus.
- Start and stop toggle mode. Confirm pressed/listening/idle state changes are
  announced once and focus remains usable.
- Trigger one understandable error and recover by starting a new session.
- Dictate a final result and confirm the field value and status are announced
  without a keyboard trap.

For an optional broader macOS or Windows run, complete the following flow with
the screen reader and keyboard only:

- Navigate to both controlled and uncontrolled fields and their voice buttons.
- Start and stop toggle mode; verify the pressed state, listening state, and
  return to idle are announced without duplicated speech.
- Start hold-to-talk with Space, release Space to stop, and confirm focus stays
  on the trigger.
- Trigger a token error and a provider disconnect; verify the error is announced
  once, is understandable, and a retry succeeds.
- Dictate an interim and final result, type while interim text is present, and
  switch fields; verify announcements do not hide or overwrite the user's edit.
- Verify every control has an understandable name, focus is visible, focus order
  follows the page, and no keyboard trap appears.

For iPhone and iPad, complete the same assertions with VoiceOver touch gestures
and the platform-appropriate activation gesture. Verify toggle and hold-to-talk
can both be operated, status and errors are announced once, focus order is
logical, and edits survive interim/final updates and field switches. A hardware
keyboard pass is useful additional evidence but does not replace the touch pass.

Attach the automated report and manual result to the same immutable candidate
used for browser/device compatibility. Missing macOS evidence blocks beta exit,
but remains an explicit unverified item for the current desktop beta. Leave
optional rows explicitly unverified when they were not run; never represent a
blank or planned check as passing.
