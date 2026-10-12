# Pharmacy CRM: Upgrade Plan

This folder is the plan for taking the current Pharmacy CRM from a working first version to an advanced, easy to use system for daily pharmacy operations.

## Documents

| # | Document | Read it when |
|---|---|---|
| 01 | [Requirements and gap analysis](01-requirements.md) | You want to know what was asked for and what is missing today |
| 02 | [Architecture and system design](02-architecture.md) | You are about to build anything; it defines modules, flows, jobs, security and targets |
| 03 | [Data model changes](03-data-model.md) | You are writing a migration or a service |
| 04 | [UI and UX plan](04-ui-ux.md) | You are building or changing a screen |
| 05 | [Implementation roadmap](05-roadmap.md) | You are planning the next piece of work; each phase has tasks and acceptance criteria |
| 06 | [Desktop proof of concept](06-desktop-poc.md) | You are working on the Windows installer; it records what was proven and what Phase 2 must solve |

## Summary

- **Product**: a platform for small retail pharmacies serving walk-in customers. The Developer (platform owner) creates and controls pharmacies; each pharmacy runs its own staff, roles and branding, fully isolated from the others. There are no customer logins or online orders.
- **Style**: modular monolith (Next.js app plus a worker process) on PostgreSQL, which also serves as job queue and search engine. Tenant isolation through a `pharmacyId` column and Row-Level Security.
- **Roles**: Developer (permanent, platform level), Pharmacy Admin (all access in their pharmacy, branding, roles, passwords), Pharmacist (stock entry and review, supplier catalogs, orders), Cashier (cash and print), and custom roles.
- **Headline features**: stock entry both manually and by OCR of a photo (supplier bills and stock lists) on one review grid, 30-day expiry alerts, stock in and out card, supplier catalogs and purchase orders with reorder suggestions, thermal retail bills with customer name and phone, cash sessions, returns, expenses and net profit, daily and monthly sales and purchase reports.
- **Deployment**: a Windows `.exe` installer (Electron with embedded PostgreSQL) for a pharmacy PC that works offline, and Docker for hosting many pharmacies on a server. Same code in both. After installing, the Developer logs in and creates the pharmacy.
- **Delivery**: ten phases over about thirteen to fourteen weeks for one developer, with the desktop installer in Phase 2, stock entry and OCR in Phase 4, and an early go-live option after Phase 5. Each phase ends in a tested, tagged release. Start with section 3 of the roadmap.

## How to use this plan

1. Start with the next unchecked phase in the roadmap.
2. Read the matching sections of the architecture, data model and UI documents before coding.
3. Tick tasks in the roadmap as they are merged, and commit the updated checklist with the work.
4. When a decision changes, update the relevant document in the same commit as the code, so the plan always matches the system.
