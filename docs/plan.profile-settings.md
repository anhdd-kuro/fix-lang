# Profile Settings Feature Implementation Plan

## Overview

This feature allows users to save, switch, import, and export application settings as named profiles. Users can easily switch between different configurations for different use cases.

## Requirements

- Save current settings as a named profile
- Switch between saved profiles
- Import profile from JSON file
- Export profile to JSON file
- Switch profiles from MainWindow UI
- Switch profiles from TrayWindow UI
- Use Ctrl+Shift+P to switch to next profile in a loop
- Show notification when profile is switched

## Data Layer Implementation

### 1. Define Types

- [x] Create `Profile` type in `apiStore.ts`
- [x] Update `SettingsStore` to include profiles array
- [x] Add current profile ID to `SettingsStore`

### 2. Update Store Schema

- [x] Add profiles array to store schema
- [x] Add currentProfileId to store schema
- [x] Add default profile

### 3. Store Implementation

- [x] Add methods to save current settings as profile
- [x] Add methods to load settings from profile
- [x] Add methods to import/export profiles
- [x] Add methods to switch between profiles

## Communication Layer Implementation

### 1. IPC Handlers

- [x] Add handler for saving current settings as profile
- [x] Add handler for loading settings from profile
- [x] Add handler for importing profile from JSON
- [x] Add handler for exporting profile to JSON
- [x] Add handler for getting all available profiles
- [x] Add handler for switching to next profile
- [x] Add handler for setting current profile

### 2. Preload API

- [x] Expose methods to save settings as profile
- [x] Expose methods to load settings from profile
- [x] Expose methods to import/export profiles
- [x] Expose methods to get available profiles
- [x] Expose methods to switch to next profile
- [x] Expose methods to set current profile

### 3. Global Shortcut

- [x] Add global shortcut (Ctrl+Shift+P) to switch to next profile

## UI Implementation

### 1. Profile Management Component

- [x] Create ProfileManager component
- [x] Implement profile list view
- [x] Add profile save dialog with name input
- [x] Add profile import/export buttons
- [x] Add profile selection dropdown

### 2. MainWindow Integration

- [x] Add profile selector to settings modal
- [x] Add profile section to settings
- [x] Show current profile in the UI

### 3. TrayWindow Integration

- [x] Add profile selector to tray window
- [x] Show current profile in tray window

## Documentation and Final Steps

- [x] Add comments to new code
- [x] Create new memory for profile management patterns
- [x] Clean up code and remove debug logs
- [ ] Update README with profile feature information
