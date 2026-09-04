# Accessibility testing

Run `pnpm test:a11y` against every release candidate. It scans both playgrounds
with axe before and after an error, and exercises toggle and hold-to-talk with
keyboard input only.

Automated checks do not replace assistive-technology testing. Record the
candidate SHA, date, tester, operating system, browser, assistive technology and
version, input device, result, and evidence URL for every manual run below. A
blank row is not a pass.

| Platform                      | Required assistive technology        | Result and evidence |
| ----------------------------- | ------------------------------------ | ------------------- |
| macOS                         | VoiceOver, current Safari            |                     |
| iPhone, current supported iOS | VoiceOver, Safari                    |                     |
| iPad, current supported iOS   | VoiceOver, Safari                    |                     |
| Windows                       | NVDA or JAWS, current Chrome or Edge |                     |

For the macOS and Windows runs, complete the flow using the screen reader and
keyboard only:

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

Attach the automated report and these manual results to the same immutable
candidate used for browser/device compatibility. Missing manual evidence blocks
a full accessibility/production claim. The desktop beta requires the automated
axe and keyboard checks; manual rows remain explicitly unverified and are not
represented as passing.
