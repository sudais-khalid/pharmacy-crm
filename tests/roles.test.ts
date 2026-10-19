import { describe, it, expect, beforeEach } from "vitest";
import { platformDb } from "@/lib/platform-db";
import { signSession, verifySession } from "@/lib/session-token";
import {
  SYSTEM_ROLES, createRole, deleteRole, duplicateRole, listRoles, updateRole, createUser, updateUser, listStaff,
  loadStaffSession, setTemporaryPassword, forceLogout, type Permission,
} from "@/modules/identity";
import { setAccountActive } from "@/modules/tenancy";
import { resetDb, makeUser, ctxOf, pharmacyId } from "./helpers";

beforeEach(resetDb);

const CASHIER = SYSTEM_ROLES.CASHIER;
const ADMIN = SYSTEM_ROLES.PHARMACY_ADMIN;
const session = async (u: { id: string; pharmacyId: string; sessionVersion: number }) =>
  loadStaffSession(await verifySession("staff", await signSession("staff", { sub: u.id, pid: u.pharmacyId, sv: u.sessionVersion })));

describe("roles", () => {
  it("a custom role changes a user's access on their next request", async () => {
    const admin = await makeUser("ADMIN");
    const role = await createRole(ctxOf(admin), { name: "Senior Cashier", permissions: [...CASHIER.permissions], landingPath: "/pos" });
    const { user } = await createUser(ctxOf(admin), { name: "Hina", email: "hina@t.test", roleId: role.id, credentials: "password" });
    const row = await platformDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect((await session(row))?.permissions).not.toContain("sales.cancel");

    await updateRole(ctxOf(admin), role.id, { name: "Senior Cashier", permissions: [...CASHIER.permissions, "sales.cancel"], landingPath: "/pos" });
    const after = await session(row); // same token, next request
    expect(after?.permissions).toContain("sales.cancel");
    expect(after?.role).toMatchObject({ name: "Senior Cashier", system: false, landingPath: "/pos" });
  });

  it("templates are read-only, and a copy of one is editable", async () => {
    const admin = await makeUser("ADMIN");
    await expect(updateRole(ctxOf(admin), CASHIER.id, { name: "Mine", permissions: [], landingPath: "/dashboard" })).rejects.toThrow(/cannot be changed/);
    await expect(deleteRole(ctxOf(admin), CASHIER.id)).rejects.toThrow(/cannot be deleted/);
    const copy = await duplicateRole(ctxOf(admin), SYSTEM_ROLES.PHARMACIST.id);
    expect(copy).toMatchObject({ name: "Pharmacist (copy)", system: false, pharmacyId });
    expect([...copy.permissions].sort()).toEqual([...SYSTEM_ROLES.PHARMACIST.permissions].sort());
    const roles = await listRoles(ctxOf(admin));
    expect(roles.map((r) => r.name)).toEqual(["Pharmacy Admin", "Pharmacist", "Cashier", "Pharmacist (copy)"]);
  });

  it("nobody grants or assigns more than they have", async () => {
    const admin = await makeUser("ADMIN");
    const managerPerms: Permission[] = ["dashboard.view", "pos.use", "users.manage", "roles.manage"];
    const managerRole = await createRole(ctxOf(admin), { name: "Shift Manager", permissions: managerPerms, landingPath: "/pos" });
    const manager = await platformDb.user.update({ where: { id: (await makeUser("CASHIER")).id }, data: { roleId: managerRole.id } });
    const asManager = ctxOf(manager, managerPerms);

    await expect(createRole(asManager, { name: "Peek", permissions: ["pos.use", "cost.view"], landingPath: "/pos" })).rejects.toThrow(/permissions you have yourself.*cost prices/);
    await expect(createUser(asManager, { name: "New", email: "new@t.test", roleId: ADMIN.id, credentials: "password" })).rejects.toThrow(/cannot give the Pharmacy Admin role/);
    await expect(createUser(asManager, { name: "New", email: "new@t.test", roleId: CASHIER.id, credentials: "password" })).rejects.toThrow(/cannot give the Cashier role/); // cashiers see customers, the manager does not
    await expect(updateUser(asManager, admin.id, { active: false })).rejects.toThrow(/access you do not have/);
    await expect(setTemporaryPassword(asManager, admin.id)).rejects.toThrow(/access you do not have/);
    await expect(forceLogout(asManager, admin.id)).rejects.toThrow(/access you do not have/);

    const narrow = await createRole(asManager, { name: "Counter only", permissions: ["pos.use"], landingPath: "/pos" });
    const { user } = await createUser(asManager, { name: "Zara", email: "zara@t.test", roleId: narrow.id, credentials: "password" });
    expect(user.role.name).toBe("Counter only");
    const staff = await listStaff(asManager);
    expect(staff.items.find((s) => s.id === admin.id)?.manageable).toBe(false);
    expect(staff.items.find((s) => s.id === user.id)?.manageable).toBe(true);
  });

  it("a first screen must be one the role can open; roles in use cannot be deleted", async () => {
    const admin = await makeUser("ADMIN");
    await expect(createRole(ctxOf(admin), { name: "Odd", permissions: ["pos.use"], landingPath: "/reports" })).rejects.toThrow(/cannot open Reports/);
    const role = await createRole(ctxOf(admin), { name: "Counter", permissions: ["pos.use"], landingPath: "/pos" });
    const { user } = await createUser(ctxOf(admin), { name: "Usman", email: "usman@t.test", roleId: role.id, credentials: "password" });
    await expect(deleteRole(ctxOf(admin), role.id)).rejects.toThrow(/still have this role/);
    await updateUser(ctxOf(admin), user.id, { roleId: CASHIER.id });
    await expect(deleteRole(ctxOf(admin), role.id)).resolves.toEqual({ ok: true });
    const actions = (await platformDb.auditLog.findMany({ where: { entity: "Role" }, orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["role.create", "role.delete"]);
  });
});

describe("staff accounts", () => {
  it("are added with an invite link or a temporary password", async () => {
    const admin = await makeUser("ADMIN");
    const invited = await createUser(ctxOf(admin), { name: "Invited", email: "inv@t.test", roleId: CASHIER.id, credentials: "invite" });
    expect(invited.credentials).toMatchObject({ kind: "invite", path: expect.stringMatching(/^\/invite\//) });
    const temp = await createUser(ctxOf(admin), { name: "Temp", email: "temp@t.test", username: "temp.user", roleId: CASHIER.id, credentials: "password" });
    expect(temp.credentials).toMatchObject({ kind: "password", password: expect.stringMatching(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/) });
    expect(temp.user).toMatchObject({ username: "temp.user", mustChangePassword: true });
    await expect(createUser(ctxOf(admin), { name: "Again", email: "other@t.test", username: "temp.user", roleId: CASHIER.id, credentials: "password" })).rejects.toThrow(/username is already in use/);
  });

  it("the last active Pharmacy Admin cannot be deactivated or demoted", async () => {
    const a1 = await makeUser("ADMIN");
    const a2 = await makeUser("ADMIN");
    await expect(updateUser(ctxOf(a1), a1.id, { roleId: CASHIER.id })).rejects.toThrow(/your own role/);
    await updateUser(ctxOf(a1), a2.id, { roleId: CASHIER.id }); // a1 remains
    await expect(updateUser(ctxOf(a2, CASHIER.permissions), a1.id, { active: false })).rejects.toThrow(/access you do not have/);

    // the Developer console and direct writes are stopped too
    await expect(setAccountActive({ devId: "dev" }, a1.id, false)).rejects.toThrow(/last active Pharmacy Admin/);
    await expect(platformDb.user.update({ where: { id: a1.id }, data: { roleId: CASHIER.id } })).rejects.toThrow(/at least one active Pharmacy Admin/);
    await expect(platformDb.user.delete({ where: { id: a1.id } })).rejects.toThrow(/at least one active Pharmacy Admin|foreign key/);

    // with a second admin again, the first may go
    await updateUser(ctxOf(a1), a2.id, { roleId: ADMIN.id });
    await expect(setAccountActive({ devId: "dev" }, a1.id, false)).resolves.toEqual({ active: false });
  });
});
