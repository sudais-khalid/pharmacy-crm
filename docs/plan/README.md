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

- **Product**: a multi-pharmacy platform. The Developer (platform owner) creates and controls pharmacies; each pharmacy runs its own staff, roles, branding and customers, fully isolated from the others.
- **Style**: modular monolith (Next.js app plus a worker process) on PostgreSQL, which also serves as job queue and search engine. Tenant isolation through a `pharmacyId` column and Row-Level Security.
- **Roles**: Developer (permanent, platform level), Pharmacy Admin (all access in their pharmacy, branding, roles, passwords), Pharmacist (stock, supplier catalogs, orders, OCR review), Cashier (cash and print), custom roles, and Customers with their own portal login.
- **Headline features**: 30-day expiry alerts, stock in and out card, OCR bill entry from a phone photo with mandatory review, supplier catalogs and purchase orders with reorder suggestions, thermal retail bills with customer name and phone, cash sessions, returns, expenses and net profit, daily and monthly sales and purchase reports, customer online orders with stock reservation.
- **Delivery**: ten phases over about fourteen weeks for one developer, with an early go-live option after Phase 5. Each phase ends in a tested, tagged release. Start with section 3 of the roadmap.

## How to use this plan

1. Start with the next unchecked phase in the roadmap.
2. Read the matching sections of the architecture, data model and UI documents before coding.
3. Tick tasks in the roadmap as they are merged, and commit the updated checklist with the work.
4. When a decision changes, update the relevant document in the same commit as the code, so the plan always matches the system.
