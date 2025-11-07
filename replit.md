# Discord Moderation Bot

## Overview
SPY Group is a Discord moderation bot designed to provide comprehensive tools for server management. It features a robust warning system with severity levels, case management for all moderation actions (warnings, timeouts, kicks, bans, hackbans), and message purging. A key component is its web-based case viewer, offering a centralized interface to browse, filter, and manage all moderation cases. The project aims to streamline moderation workflows and provide detailed logging and accountability for staff actions.

## User Preferences
I prefer iterative development, so please break down tasks into smaller, manageable steps. Before implementing any major changes, please ask for my approval. Ensure the code is clean, well-commented, and follows best practices. I appreciate detailed explanations of complex logic. Do not make changes to the `Staff/IDS` folder. Do not make changes to the `config.json` file.

## System Architecture
The bot operates using Node.js 20 and the Discord.js library, with an Express.js server for the web-based case viewer. It employs a hierarchical role-based permission system, mirroring Discord roles for granular access control to commands. All moderation actions are logged to a dedicated channel with rich embeds.

**UI/UX Decisions:**
The web viewer features a consistent design with a login page and role-based access. User avatars, role badges, and role colors are synchronized with Discord for a unified visual experience. The interface includes statistics, filtering options, detailed case views, and user profile pages.

**Technical Implementations:**
- **Warning System**: Tracks warnings by severity (minor/moderate/severe) with DM notifications and history.
- **Case Management**: Utilizes immutable case IDs for all moderation actions - once assigned, case numbers never change (audit trail integrity). Cases are stored in `cases.json` (single source of truth) and automatically synchronized to an organized folder structure (`cases/`) where each user has a dedicated file. Both the Discord bot and web viewer use identical load/save/delete logic to ensure consistent state. The `organize-cases.js` module handles folder synchronization, removing empty user files automatically.
- **Timeout, Kick, Ban (including Hackban)**: Dedicated commands for these actions, all integrated with the case management system. Staff protection ensures moderators cannot target other staff.
- **Message Purging**: Bulk deletion of messages with optional user filtering.
- **Slash Commands**: Full support for Discord slash commands, enhancing user interaction.
- **Web Case Viewer**: Modern HTML-based web application running on port 5000. Architecture uses a clean separation between frontend and backend:
  - **Backend (viewer.js)**: RESTful API providing JSON endpoints for authentication, case management, and user data. Handles secure session management with bcrypt-hashed passwords.
  - **Frontend (public/)**: Static HTML pages with client-side JavaScript for dynamic interactions. Includes login page, cases dashboard with real-time filtering and statistics.
  - **API Endpoints**: `/api/login`, `/api/session`, `/api/logout`, `/api/cases`, `/api/cases/:id`
  - **Role-based Access Control**: Permission levels synchronized from Discord roles, with admin-only features like case deletion.
  - **Auto-sync**: Role colors and avatars automatically update from Discord via the `guildMemberUpdate` event listener.
- **Ban Override Code System**: A mechanism allowing specific roles (Trial Moderators, Moderators) to perform ban actions under a unique, single-use override code system. Codes are automatically generated and logged to a designated channel.
- **Deployment**: Configured to run both the Discord bot and the web viewer simultaneously on a Reserved VM, accessible via a custom domain (e.g., `case.spy-gaming.com`).

## External Dependencies
- **Node.js 20**: Runtime environment.
- **Discord.js**: JavaScript library for interacting with the Discord API.
- **Express.js**: Web application framework for the case viewer.
- **bcrypt**: Library for password hashing in the web viewer.
- **express-session**: Middleware for session management in the web viewer.