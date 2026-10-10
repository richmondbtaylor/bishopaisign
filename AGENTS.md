# Architecture rules

- Keep document field coordinates percentage-based and derive overlays from the currently rendered PDF size, so editing and signing remain aligned across viewport sizes.
- Use pointer events for document-canvas manipulation, so touch, mouse, and stylus share one interaction path.