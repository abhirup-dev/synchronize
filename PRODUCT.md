# Product

## Register

product

## Users

Human operators coordinating multiple local Claude, Codex, and Pi agent sessions. They work in a dense, live operations surface where they need to scan rooms, follow agent activity, read long technical exchanges, and intervene without losing context.

## Product Purpose

Synchronize is a local-first messaging bus and operator UI for agent sessions. The web product makes the daemon's groups, direct messages, threads, activity, and agent presence legible and controllable while keeping runtime data on the user's machine.

## Brand Personality

Technical, lively, and precise. The interface can have a distinct visual identity, but controls should stay quiet, familiar, and subordinate to the conversation.

## Anti-references

- Generic SaaS dashboards with decorative cards and empty visual chrome.
- Skeuomorphic or tiled controls whose depth competes with the content.
- Glass surfaces that become transparent enough to lose control contrast.
- Dense overlays that obscure or misalign the chat and thread surfaces they control.

## Design Principles

1. Keep the conversation primary; navigation and controls should frame it, never cover it.
2. Make layout state explicit: rails, overlays, and thread controls must align to the surface they operate on.
3. Treat skins as complete visual systems. Glass is flat, restrained, and layered; brutal depth cues must not leak into it.
4. Preserve dense operational information while maintaining stable alignment and predictable interaction targets.
5. Reuse shared primitives and semantic tokens so equivalent controls look and behave alike everywhere.

## Accessibility & Inclusion

Maintain keyboard navigation, visible focus states, semantic labels, reduced-motion support, and readable contrast across light and dark palettes. Storybook interaction and accessibility checks are part of the component contract.
