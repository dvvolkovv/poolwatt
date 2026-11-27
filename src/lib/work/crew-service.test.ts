// §48 «Назначение инженеру или бригаде» — сама бригада.
//
// Бригада принадлежит сети, и распоряжается ею тот же человек, что и
// сотрудниками §47. Здесь проверяется именно это и ещё одно: человек живёт в
// нескольких бригадах, потому что в жизни инженер утром едет с бригадой на
// монтаж, а днём один по жалобе.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { inviteEmployee } from "@/lib/staff/staff-service";
import {
  CrewError,
  addCrewMember,
  createCrew,
  readCrews,
  removeCrew,
  removeCrewMember,
  setCrewRegions,
  setEmployeeRegions,
} from "./crew-service";

const PREFIX = "test_crew_";
const SLUG = `${PREFIX}net`;
const OTHER_SLUG = `${PREFIX}other`;

let operatorId: string;
let otherOperatorId: string;
let ownerUserId: string;
let strangerUserId: string;
let ania: string;
let boris: string;
/** Сотрудник другой сети. */
let outsider: string;
let pointId: string;

async function wipe() {
  for (const slug of [SLUG, OTHER_SLUG]) {
    await prisma.workOrder.deleteMany({ where: { operator: { slug } } });
    await prisma.crew.deleteMany({ where: { operator: { slug } } });
    await prisma.employee.deleteMany({ where: { operator: { slug } } });
    await prisma.staffRole.deleteMany({ where: { operator: { slug } } });
    await prisma.acceptancePoint.deleteMany({ where: { operator: { slug } } });
    await prisma.chargerOperator.deleteMany({ where: { slug } });
  }
}

async function makeUser(name: string) {
  return prisma.user.upsert({
    where: { username: `${PREFIX}${name}` },
    update: {},
    create: { username: `${PREFIX}${name}`, passwordHash: "x" },
  });
}

beforeAll(async () => {
  await wipe();

  ownerUserId = (await makeUser("owner")).id;
  strangerUserId = (await makeUser("stranger")).id;
  const aniaUser = await makeUser("ania");
  const borisUser = await makeUser("boris");
  const outsiderUser = await makeUser("outsider");

  operatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: SLUG,
        displayName: "Crew test network",
        claimedById: ownerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;
  otherOperatorId = (
    await prisma.chargerOperator.create({
      data: {
        slug: OTHER_SLUG,
        displayName: "Another network",
        claimedById: strangerUserId,
        claimedAt: new Date(),
      },
    })
  ).id;

  pointId = (
    await prisma.acceptancePoint.create({
      data: {
        operatorId,
        type: "CHARGING_STATION",
        name: "Crew point",
        status: "PUBLISHED",
        country: "SK",
        city: "Košice",
      },
    })
  ).id;

  ania = (
    await inviteEmployee({
      operatorId,
      actorUserId: ownerUserId,
      username: aniaUser.username,
      roleName: "ENGINEER",
      pointIds: [],
    })
  ).id;
  boris = (
    await inviteEmployee({
      operatorId,
      actorUserId: ownerUserId,
      username: borisUser.username,
      roleName: "ENGINEER",
      pointIds: [],
    })
  ).id;
  outsider = (
    await inviteEmployee({
      operatorId: otherOperatorId,
      actorUserId: strangerUserId,
      username: outsiderUser.username,
      roleName: "ENGINEER",
      pointIds: [],
    })
  ).id;
});

beforeEach(async () => {
  await prisma.workOrder.deleteMany({ where: { operatorId } });
  await prisma.crew.deleteMany({ where: { operatorId: { in: [operatorId, otherOperatorId] } } });
});

afterAll(async () => {
  await wipe();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
});

describe("createCrew", () => {
  it("refuses a crew in somebody else's network", async () => {
    await expect(
      createCrew(operatorId, strangerUserId, { name: "Theirs", regions: [] }),
    ).rejects.toThrow(CrewError);
  });

  it("tidies the regions it is given", async () => {
    const crew = await createCrew(operatorId, ownerUserId, {
      name: "  East crew  ",
      regions: [" Košice ", "košice", "", "Prešov"],
    });
    expect(crew.name).toBe("East crew");
    expect(crew.regions).toEqual(["Košice", "Prešov"]);
  });

  it("refuses a second crew with the same name", async () => {
    await createCrew(operatorId, ownerUserId, { name: "East crew", regions: [] });
    await expect(
      createCrew(operatorId, ownerUserId, { name: "East crew", regions: [] }),
    ).rejects.toThrow(CrewError);
  });

  it("writes the new crew into the audit log", async () => {
    const crew = await createCrew(operatorId, ownerUserId, { name: "Audited", regions: [] });
    const entry = await prisma.auditLog.findFirst({
      where: { entity: "Crew", entityId: crew.id, action: "crew.created" },
    });
    expect(entry?.actor).toBe(ownerUserId);
  });
});

describe("members", () => {
  it("refuses a member from another network", async () => {
    const crew = await createCrew(operatorId, ownerUserId, { name: "East crew", regions: [] });
    await expect(addCrewMember(crew.id, outsider, ownerUserId)).rejects.toThrow(CrewError);
  });

  it("keeps a person in two crews", async () => {
    const morning = await createCrew(operatorId, ownerUserId, { name: "Morning", regions: [] });
    const evening = await createCrew(operatorId, ownerUserId, { name: "Evening", regions: [] });
    await addCrewMember(morning.id, ania, ownerUserId);
    await addCrewMember(evening.id, ania, ownerUserId);

    const rows = await readCrews(operatorId, ownerUserId);
    expect(rows?.filter((c) => c.members.some((m) => m.employeeId === ania))).toHaveLength(2);
  });

  it("adding the same person twice changes nothing", async () => {
    const crew = await createCrew(operatorId, ownerUserId, { name: "East crew", regions: [] });
    await addCrewMember(crew.id, ania, ownerUserId);
    await addCrewMember(crew.id, ania, ownerUserId);
    const rows = await readCrews(operatorId, ownerUserId);
    expect(rows?.find((c) => c.id === crew.id)?.members).toHaveLength(1);
  });

  it("moves the lead flag instead of keeping two leads", async () => {
    const crew = await createCrew(operatorId, ownerUserId, { name: "East crew", regions: [] });
    await addCrewMember(crew.id, ania, ownerUserId, { lead: true });
    await addCrewMember(crew.id, boris, ownerUserId, { lead: true });

    const members = await prisma.crewMember.findMany({ where: { crewId: crew.id } });
    expect(members.filter((m) => m.lead).map((m) => m.employeeId)).toEqual([boris]);
  });

  it("removes the last member and keeps the crew", async () => {
    const crew = await createCrew(operatorId, ownerUserId, { name: "East crew", regions: [] });
    await addCrewMember(crew.id, ania, ownerUserId);
    await removeCrewMember(crew.id, ania, ownerUserId);

    const rows = await readCrews(operatorId, ownerUserId);
    const found = rows?.find((c) => c.id === crew.id);
    expect(found).toBeDefined();
    expect(found?.members).toEqual([]);
  });
});

describe("regions", () => {
  it("sets the cities a crew covers", async () => {
    const crew = await createCrew(operatorId, ownerUserId, { name: "East crew", regions: [] });
    const after = await setCrewRegions(crew.id, ownerUserId, ["Košice", " Košice "]);
    expect(after.regions).toEqual(["Košice"]);
  });

  it("sets the cities an engineer covers", async () => {
    await setEmployeeRegions(ania, ownerUserId, ["Prešov"]);
    const fresh = await prisma.employee.findUniqueOrThrow({ where: { id: ania } });
    expect(fresh.regions).toEqual(["Prešov"]);
  });

  it("refuses to touch an engineer of another network", async () => {
    await expect(setEmployeeRegions(outsider, ownerUserId, ["Košice"])).rejects.toThrow(CrewError);
  });
});

describe("removeCrew", () => {
  it("refuses while the crew still has work", async () => {
    const crew = await createCrew(operatorId, ownerUserId, { name: "East crew", regions: [] });
    await prisma.workOrder.create({
      data: {
        operatorId,
        pointId,
        crewId: crew.id,
        type: "REPAIR",
        title: "Open work",
        description: "Still on",
        status: "ASSIGNED",
      },
    });
    await expect(removeCrew(crew.id, ownerUserId)).rejects.toThrow(CrewError);
  });

  it("removes an idle crew", async () => {
    const crew = await createCrew(operatorId, ownerUserId, { name: "East crew", regions: [] });
    await addCrewMember(crew.id, ania, ownerUserId);
    await removeCrew(crew.id, ownerUserId);
    await expect(prisma.crew.findUnique({ where: { id: crew.id } })).resolves.toBeNull();
  });
});

describe("readCrews", () => {
  it("shows nothing of somebody else's network", async () => {
    await expect(readCrews(operatorId, strangerUserId)).resolves.toBeNull();
  });
});
