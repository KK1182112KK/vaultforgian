# Responsive Chat Hub Collapse Design

## Summary
When the Codex workspace becomes narrow, the chat hub should temporarily collapse so the transcript and composer keep priority. This should reuse the existing hub collapse UI and state flow instead of hiding the body with CSS-only tricks.

The responsive collapse must be reversible. If the hub was open before the view narrowed, it should reopen automatically when the width becomes wide again. If the user had already collapsed it manually, widening the view must not reopen it.

## Goals
- Collapse the chat hub automatically when the workspace width is `860px` or narrower.
- Reuse the existing `studyHubState.isCollapsed` behavior so the toggle icon, ARIA state, and rendered layout stay consistent.
- Preserve the user's manual collapse intent when the view crosses the breakpoint.
- Keep the existing manual collapse toggle fully functional.

## Non-Goals
- Redesigning the Panel Studio layout or card hierarchy.
- Adding a new persisted settings flag for responsive behavior.
- Changing existing collapse visuals beyond what `.is-collapsed` already does.
- Introducing a separate mobile-only hub component.

## Behavior
### Breakpoint
Use the workspace content width from `CodexWorkspaceView.contentEl`. When the measured width is `860px` or narrower, the view enters responsive-collapse mode.

### Entering Narrow Width
- If the hub is currently open, store the current manual collapsed state as `false`, mark the view as auto-collapsed, and call `service.setStudyHubCollapsed(true)`.
- If the hub is already manually collapsed, store the current manual collapsed state as `true`, but do not force any additional state changes.

### Returning to Wide Width
- If the view is not in auto-collapsed mode, do nothing.
- If the view is in auto-collapsed mode, restore the stored manual collapsed state and clear the auto-collapse markers.
- This means a hub that was open before narrowing reopens, while a hub that was already closed stays closed.

### Manual Toggle While Narrow
Manual toggles while the view is narrow must update the remembered manual state.

Expected outcomes:
- User opens the hub while narrow: the view remains narrow, but the remembered manual state becomes open, so widening keeps it open.
- User closes the hub while narrow: the remembered manual state becomes closed, so widening keeps it closed.

### Render Contract
Responsive behavior must continue to go through the existing collapse state that `HubRenderer` already reads. The rendered class list, icon, and `aria-expanded` value should therefore stay aligned with the service state.

## Implementation Plan
### View-Local State
Add view-local helper state in `src/views/codexWorkspaceView.ts`:
- `responsiveHubAutoCollapsed: boolean`
- `responsiveHubManualCollapsed: boolean | null`

This state stays local to the workspace view and is not persisted.

### Resize Synchronization
Extend the existing `ResizeObserver` in `CodexWorkspaceView.onOpen()` so it:
1. Measures `contentEl.clientWidth`.
2. Calls a new helper such as `syncResponsiveHubCollapse(width: number)`.
3. Continues to call `composerRenderer.syncInputHeight()`.

### Manual State Tracking
When the hub state changes while the view is narrow, treat that as the new manual preference:
- If the view is narrow and the user toggles the hub, update `responsiveHubManualCollapsed` to match the current `studyHubState.isCollapsed`.
- If the view becomes wide again, restore from that remembered value.

This tracking can remain in `CodexWorkspaceView` by comparing the current service state during render or resize synchronization. No store type changes are required.

### Service Boundary
Do not change `CodexService`, `Store`, or persisted types for this feature. The view should only call existing methods:
- `service.getStudyHubState()`
- `service.setStudyHubCollapsed(isCollapsed)`

## Testing
Verification should cover:
- Narrow width auto-collapses an open hub.
- Wide width restores the previously open state.
- If the hub was already manually collapsed before narrowing, widening does not reopen it.
- Manual toggles while narrow update the restored state correctly.
- Existing manual collapse still works when the width never crosses the breakpoint.

Implementation verification:
- `npm run typecheck`
- targeted UI test coverage around responsive hub behavior
- `npm run build`
- `npm run check` if the updated tests/build pass cleanly

## Risks
- If responsive logic writes directly to persisted state without remembering the previous manual state, widening the view can leave the hub stuck closed.
- A CSS-only approach would desynchronize visuals from the actual hub state and should be avoided.
- Resize handling must not cause toggle loops; state updates should only happen when crossing the breakpoint or when manual intent changes.
