# IServ Integration — Domain Glossary

## Core Concepts
- **IServ**: School information system (Schulverwaltungssoftware) used by German schools
- **IServ API**: REST API endpoints for accessing IServ data (mail, timetable, exercises, etc.)
- **Plugin**: Obsidian plugin that integrates IServ data into Obsidian vault

## Data Types
- **Timetable**: Weekly class schedule with time slots, rooms, teachers
- **Substitutions**: Last-minute schedule changes (Vertretungen)
- **Exercises**: Homework/assignments with due dates and status
- **Mails**: Internal school email messages
- **Review Queue**: Files from IServ that need user review before filing

## Technical Terms
- **Safe Storage**: Obsidian API for encrypting sensitive data (credentials)
- **Plugin Data**: Obsidian's loadData/saveData for persistent storage
- **Modal**: Obsidian UI overlay for focused interactions
- **View**: Obsidian sidebar/leaf components for persistent UI

## Naming Conventions
- **Code**: English (variables, functions, classes, comments)
- **User-facing Strings**: German (notices, UI labels, empty states)