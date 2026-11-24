// US-47 — "назначить сотруднику роль на конкретные пункты", ТЗ §47.
// The criterion is the whole story: the employee sees only the points and
// the actions they were granted.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  BUILT_IN_ROLES,
  can,
  ensureBuiltInRoles,
  inviteEmployee,
  readEmployee,
  removeEmployee,
  setEmployeeScope,
  visiblePointIds,
} from "./staff-service";

const PREFIX = "test_staff_";
const SLUG = `${PREFIX}net`;

let operatorId: string;
let ownerUserId: string;
let engineerUserId: string;
let accountantUserId: string;
let pointA: string;
let pointB: string;

async function wipe() {
  await prisma.employee.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.staffRole.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.acceptancePoint.deleteMany({ where: { operator: { slug: SLUG } } });
  await prisma.chargerOperator.deleteMany({ where: { slug: SLUG } });
}

async function seedPoint(name: string) {
  const p = await prisma.acceptancePoint.create({
    data: { operatorId, type: "CHARGING_STATION", name, status: "PUBLISHED" },
  });
  return p.id;
}

beforeAll(async () => {
  await wipe();
  ownerUserId = (
    await prisma.user.upsert({
      where: { username: `${PREFIX}owner` },
      update: {},
      create: { username: `${PREFIX}owner`, passwordHash: "x" },
    })
  ).id;
  engineerUserId = (
    await prisma.user.upsert({
      where: { username: `${PREFIX}engineer` },
      update: {},
      create: { username: `${PREFIX}engineer`, passwordHash: "x" },
    })
  ).id;
  accountantUserId = (
    await prisma.user.upsert({
      where: { username: `${PREFIX}accountant` },
      update: {},
      create: { username: `${PREFIX}accountant`, passwordHash: "x" },
    })
  ).id;

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "Staff test network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;

  pointA = await seedPoint("Point A");
  pointB = await seedPoint("Point B");
});

beforeEach(async () => {
  await prisma.employee.deleteMany({ where: { operatorId } });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("ensureBuiltInRoles — the eight roles of §47", () => {
  it("creates them once and leaves them alone on a second call", async () => {
    const first = await ensureBuiltInRoles(operatorId);
    const again = await ensureBuiltInRoles(operatorId);

    expect(first).toHaveLength(BUILT_IN_ROLES.length);
    expect(again.map((r) => r.id).sort()).toEqual(first.map((r) => r.id).sort());
    const stored = await prisma.staffRole.count({ where: { operatorId } });
    expect(stored).toBe(BUILT_IN_ROLES.length);
  });

  it("gives the engineer work orders and the warehouse, and no finance", async () => {
    const roles = await ensureBuiltInRoles(operatorId);
    const engineer = roles.find((r) => r.name === "ENGINEER")!;

    expect(engineer.permissions).toContain("workorders.write");
    expect(engineer.permissions).toContain("warehouse.write");
    expect(engineer.permissions).not.toContain("finance.read");
    expect(engineer.permissions).not.toContain("staff.write");
  });
});

describe("inviteEmployee — §47", () => {
  it("adds somebody to the network with a role and a scope", async () => {
    const employee = await inviteEmployee({
      operatorId,
      actorUserId: ownerUserId,
      username: `${PREFIX}engineer`,
      roleName: "ENGINEER",
      pointIds: [pointA],
    });

    expect(employee.userId).toBe(engineerUserId);
    expect(employee.pointIds).toEqual([pointA]);
    const audit = await prisma.auditLog.findFirst({
      where: { entity: "Employee", entityId: employee.id },
      orderBy: { at: "desc" },
    });
    expect(audit?.action).toBe("staff.invited");
  });

  it("refuses an invitation from somebody who does not own the network", async () => {
    await expect(
      inviteEmployee({
        operatorId,
        actorUserId: engineerUserId,
        username: `${PREFIX}accountant`,
        roleName: "ACCOUNTANT",
        pointIds: [],
      }),
    ).rejects.toThrow(/not your/i);
  });

  it("refuses an unknown person and an unknown role", async () => {
    await expect(
      inviteEmployee({
        operatorId,
        actorUserId: ownerUserId,
        username: "nobody-at-all",
        roleName: "ENGINEER",
        pointIds: [],
      }),
    ).rejects.toThrow(/user/i);

    await expect(
      inviteEmployee({
        operatorId,
        actorUserId: ownerUserId,
        username: `${PREFIX}engineer`,
        roleName: "WIZARD",
        pointIds: [],
      }),
    ).rejects.toThrow(/role/i);
  });

  it("refuses a scope that names a point of another network", async () => {
    await expect(
      inviteEmployee({
        operatorId,
        actorUserId: ownerUserId,
        username: `${PREFIX}engineer`,
        roleName: "ENGINEER",
        pointIds: ["not-a-point-of-this-network"],
      }),
    ).rejects.toThrow(/point/i);
  });

  it("does not add the same person twice", async () => {
    await inviteEmployee({
      operatorId,
      actorUserId: ownerUserId,
      username: `${PREFIX}engineer`,
      roleName: "ENGINEER",
      pointIds: [],
    });
    await expect(
      inviteEmployee({
        operatorId,
        actorUserId: ownerUserId,
        username: `${PREFIX}engineer`,
        roleName: "ACCOUNTANT",
        pointIds: [],
      }),
    ).rejects.toThrow(/already/i);
  });
});

describe("can — only the permitted points and actions (US-47)", () => {
  it("lets an engineer work on the point they were given", async () => {
    const employee = await invited([pointA]);

    expect(can(employee, "workorders.write", pointA)).toBe(true);
    expect(can(employee, "workorders.read", pointA)).toBe(true);
  });

  it("refuses the same engineer on a point outside their scope", async () => {
    const employee = await invited([pointA]);
    expect(can(employee, "workorders.write", pointB)).toBe(false);
  });

  it("refuses an action the role never had, even inside the scope", async () => {
    const employee = await invited([pointA]);
    expect(can(employee, "finance.read", pointA)).toBe(false);
    expect(can(employee, "staff.write", pointA)).toBe(false);
  });

  it("treats an empty scope as the whole network", async () => {
    const employee = await invited([]);
    expect(can(employee, "workorders.write", pointA)).toBe(true);
    expect(can(employee, "workorders.write", pointB)).toBe(true);
  });

  it("answers a question about no point in particular on the role alone", async () => {
    const employee = await invited([pointA]);
    expect(can(employee, "workorders.read")).toBe(true);
    expect(can(employee, "finance.read")).toBe(false);
  });

  async function invited(pointIds: string[]) {
    await inviteEmployee({
      operatorId,
      actorUserId: ownerUserId,
      username: `${PREFIX}engineer`,
      roleName: "ENGINEER",
      pointIds,
    });
    return (await readEmployee(operatorId, engineerUserId))!;
  }
});

describe("readEmployee and visiblePointIds", () => {
  it("knows nothing about somebody who is not on the staff", async () => {
    expect(await readEmployee(operatorId, accountantUserId)).toBeNull();
  });

  it("gives the owner every point without an employee row", async () => {
    const visible = await visiblePointIds(operatorId, ownerUserId);
    expect(visible).toBeNull(); // null means "no restriction"
  });

  it("narrows an employee to their own points", async () => {
    await inviteEmployee({
      operatorId,
      actorUserId: ownerUserId,
      username: `${PREFIX}engineer`,
      roleName: "ENGINEER",
      pointIds: [pointB],
    });

    expect(await visiblePointIds(operatorId, engineerUserId)).toEqual([pointB]);
  });

  it("gives a stranger nothing at all", async () => {
    expect(await visiblePointIds(operatorId, accountantUserId)).toEqual([]);
  });
});

describe("setEmployeeScope and removeEmployee", () => {
  it("moves an employee to another point", async () => {
    const employee = await inviteEmployee({
      operatorId,
      actorUserId: ownerUserId,
      username: `${PREFIX}engineer`,
      roleName: "ENGINEER",
      pointIds: [pointA],
    });

    await setEmployeeScope(employee.id, ownerUserId, [pointB]);

    const after = await readEmployee(operatorId, engineerUserId);
    expect(after?.pointIds).toEqual([pointB]);
    expect(can(after!, "workorders.write", pointA)).toBe(false);
  });

  it("takes an employee off the staff", async () => {
    const employee = await inviteEmployee({
      operatorId,
      actorUserId: ownerUserId,
      username: `${PREFIX}engineer`,
      roleName: "ENGINEER",
      pointIds: [],
    });

    await removeEmployee(employee.id, ownerUserId);

    expect(await readEmployee(operatorId, engineerUserId)).toBeNull();
  });
});
