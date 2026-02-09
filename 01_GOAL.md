# Project Goal – AI Powered TYPO3 Content Element Builder

## Objective

The goal of this project is to build a **standalone web-based tool** that allows users to visually create **TYPO3 Content Elements** without using the TYPO3 backend.

The tool will work similar to EXT:mask, but:
- Runs on a public domain (standalone app)
- Uses a modern drag-and-drop UI
- Generates TYPO3-ready files automatically
- Uses Codex CLI prompts for optional template assistance (no direct API dependency)

---

## What Problem We Are Solving

Creating TYPO3 Content Elements currently requires:
- TYPO3 backend access
- Manual TCA, SQL, TypoScript, and Fluid coding
- TYPO3-specific knowledge

This tool removes that friction by allowing:
- Visual element building
- JSON-based element definition
- Automatic file generation
- Multi-element bundle export in a single ZIP
- Safe, repeatable, and versionable output

---

## What the Tool Will Do

1. Allow users to visually design one or more Content Elements using drag & drop
2. Convert the design into a **strict JSON specification**
3. Validate the specification (safe + TYPO3-compatible)
4. Generate TYPO3 files deterministically
5. Generate TYPO3 extension artifacts: TCA, SQL, TypoScript, TSConfig, Fluid templates, icons, language files
6. Package single or multiple elements into a downloadable ZIP
7. Developer places generated files into a TYPO3 extension
8. Content Elements become available in TYPO3 backend

---

## What the Tool Will NOT Do

- Will not directly write files into a live TYPO3 installation
- Will not execute arbitrary PHP from user input
- Will not replace TYPO3 core APIs
- Will not depend on AI for critical TYPO3 logic

---

## Target TYPO3 Version

- TYPO3 v12 LTS
- PHP 8.2+

---

## Success Criteria

- Generated Content Elements work without manual fixes
- Output is predictable and upgrade-safe
- Tool can be used without TYPO3 backend access
- AI usage is optional and safe
