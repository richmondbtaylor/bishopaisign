

## Plan: Interactive Drag-and-Drop Fields with Delete and Resize

### Problem
Fields placed on the PDF canvas lack full interactivity — dragging may not work reliably, there's no way to resize fields, and the delete button is small and easy to miss.

### Changes to `src/pages/DocumentEditor.tsx`

#### 1. Add Resize Handles to Fields
- Add resize state: `resizingFieldId`, `resizeHandle` (which corner/edge), and `resizeStartData` (initial mouse pos + field dimensions)
- Render 4 corner resize handles on the selected field (small squares at each corner)
- On mousedown on a handle, enter resize mode; on mousemove, update width/height (and x/y for top/left handles) with minimum size constraints (e.g. 20x20)
- Integrate resize into the existing `handleCanvasMouseMove` and `handleCanvasMouseUp` handlers

#### 2. Improve Field Dragging
- The current drag implementation uses `onMouseDown` → `onMouseMove` on the canvas, which should work but may conflict with text selection or other events
- Add `user-select: none` to the canvas during drag to prevent text selection interference
- Ensure `e.preventDefault()` is called in `onMouseMove` during drag to avoid browser default drag behavior

#### 3. Enhanced Delete and Selection UI
- When a field is selected, show a small toolbar above it with: delete button (trash icon), and field dimensions display
- Make the delete button larger and more visible (not just a tiny circle)
- Add keyboard support: pressing `Delete` or `Backspace` removes the selected field

#### 4. Field Properties Panel
- When a field is selected, show a small panel in the sidebar with:
  - Width/Height number inputs to set exact size
  - Required checkbox toggle
  - Label text input
  - Delete button

### Technical Details
- Resize uses the same mouse event pattern as drag: track which handle is grabbed, compute delta from start position, apply to width/height
- Minimum field size: 20×20px to prevent invisible fields
- Corner handles: 8×8px squares positioned at field corners, only visible on selected field
- Keyboard listener via `useEffect` with `keydown` event on `window`, checking for Delete/Backspace when `selectedField` is set

### Files Modified
- `src/pages/DocumentEditor.tsx` — All changes in this single file

