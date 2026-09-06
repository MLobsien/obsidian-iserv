# ADR-0002: IServ API Integration

## Status
Accepted

## Context
IServ provides REST APIs for accessing school data. The plugin needs to authenticate and fetch data reliably.

## Decision
- Use Node.js `https` module for full cookie control (Obsidian `requestUrl` swallows Set-Cookie)
- Session persistence via IServSession cookie
- Rate limiting to avoid API abuse
- Base64 decoding for mail content

## Consequences
- Desktop-only initially (Node.js https required)
- Cookie jar management for session state
- Automatic re-login on session expiry