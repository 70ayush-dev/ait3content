# ait3content-builder

A standalone web-based tool that allows users to visually create **TYPO3 Content Elements** without using the TYPO3 backend.

## Overview

This project provides a modern, drag-and-drop interface to design content elements and automatically generates the necessary TYPO3 files (TCA, SQL, TypoScript, Fluid templates, etc.). It aims to streamline the workflow for TYPO3 developers/integrators by generating strict, valid, and versionable content element definitions.

## Features

- **Visual Editor**: Drag-and-drop UI for building content elements.
- **Auto-Generation**: Creates TYPO3-ready files (TCA, SQL, Typoscript, etc.).
- **Downloadable Bundle**: Export elements as a ZIP file ready for Extension placement.
- **Standalone**: Runs independently of a TYPO3 installation.
- **Modern Stack**: Built with Next.js, React, and Tailwind CSS.

## Tech Stack

- **Framework**: Next.js 16
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **State/Form**: React Hook Form, Zod
- **Drag & Drop**: @dnd-kit

## Getting Started

### Prerequisites

- Node.js (v18+ recommended)
- npm or yarn

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/70ayush-dev/ait3content.git
    cd ait3content
    ```

2.  Install dependencies:
    ```bash
    npm install
    # or
    yarn install
    ```

3.  Run the development server:
    ```bash
    npm run dev
    # or
    yarn dev
    ```

4.  Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Project Structure

- `app/`: Next.js app directory.
- `components/`: React components.
- `lib/`: Utility functions and shared logic.
- `public/`: Static assets.

## Goal

For more details on the project goals, see [01_GOAL.md](./01_GOAL.md).
