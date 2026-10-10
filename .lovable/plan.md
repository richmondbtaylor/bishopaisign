## Mobile-friendly document workflow

### What I verified

- The document editor is still desktop-first: its PDF is fixed at 800px wide, its tools occupy a permanent left panel, and field moving/resizing only listens for mouse events.
- Dragging a new field uses browser drag-and-drop, which is unreliable on phones and tablets.
- The dashboard navigation becomes an overflowing row of icon buttons rather than a collapsible menu.
- The signing screen already uses touch-friendly dialogs and pointer events, but its header and bottom action bar need tighter small-screen behavior.

### 1. Collapsible mobile navigation

- Replace the dashboard's overflowing phone navigation with one clear menu button that opens a labeled slide-out menu.
- Keep the existing desktop navigation unchanged at larger widths.
- Make document actions and filters stack or collapse cleanly without horizontal overflow.

### 2. Mobile document editor

- Turn the editor's left panel into a slide-out tool drawer on phones and tablets while preserving the current collapsible desktop panel.
- Organize Signers, Fields, and Settings into collapsible sections so only the needed controls are open.
- Make the title and Save/Send actions fit a narrow header, with secondary actions available from a compact menu when needed.
- Scale the PDF to the available screen width instead of forcing an 800px canvas, while preserving percentage-based field coordinates.
- Hide or collapse the page rail on small screens and provide a compact page selector.

### 3. Touch placement, movement, and resizing

- Use pointer events for placed fields so the same interaction works with touch, mouse, and stylus.
- Add tap-to-place as the mobile alternative to desktop drag-and-drop: choose a field type, then tap the PDF where it belongs.
- Keep desktop drag-and-drop working.
- Increase selected-field handles and action targets on touch screens, prevent accidental page scrolling while a field is being moved, and keep fields constrained inside the page.
- Preserve signer color assignment and allow field reassignment or deletion from a touch-friendly selected-field toolbar.

### 4. Mobile signing polish

- Keep signing fields aligned to the visibly rendered PDF at every phone width and orientation.
- Make the header compact and ensure the bottom progress/actions never overlap or squeeze the document.
- Keep signature, initials, date, checkbox, and text dialogs within the viewport with comfortable touch targets and safe-area spacing.
- Preserve the existing automatic movement to the next unfinished field.

### 5. Verification

- Add focused tests for touch placement, touch movement, and responsive field alignment.
- Check the editor, dashboard, and signing flow at phone, tablet, and desktop widths.
- Verify menus can always be opened again after closing, fields remain movable, and no controls or PDF content overflow the screen.

## Technical details

- Reuse the existing Sheet, Button, Dialog, and collapsible UI patterns rather than adding a separate mobile experience.
- Convert editor interactions from mouse-only listeners to pointer capture and pointer events.
- Calculate rendered PDF dimensions from the available container width and use those same dimensions for field overlays.
- Keep all saved coordinates percentage-based so mobile editing does not change final PDF placement.