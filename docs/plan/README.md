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

## Summary

- **Style**: modular monolith (Next.js app plus a worker process) on PostgreSQL, which also serves as the job queue and search engine. No extra infrastructure.
- **Roles**: Developer Admin, Super Admin, Pharmacist, Cashier, with roles stored in the database and permissions defined in code.
- **Headline features**: 30-day expiry alerts, stock in and out card, OCR bill entry from a phone photo with mandatory review, supplier purchase orders with reorder suggestions, thermal retail bills with customer name and phone, cash sessions, returns, expenses and net profit, daily and monthly sales and purchase reports.
- **Delivery**: eight phases over about ten to eleven weeks for one developer. Each phase ends in a tested, tagged release.

## How to use this plan

1. Start with the next unchecked phase in the roadmap.
2. Read the matching sections of the architecture, data model and UI documents before coding.
3. Tick tasks in the roadmap as they are merged, and commit the updated checklist with the work.
4. When a decision changes, update the relevant document in the same commit as the code, so the plan always matches the system.
