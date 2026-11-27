// Кто имеет право тронуть склад — §47 и §49.
//
// §49 поручает списание инженеру («бронирует и списывает их по факту»), а
// §47 выдаёт право `warehouse.write` ролям ENGINEER и STOREKEEPER. До этого
// модуля склад пускал только владельца сети, то есть US-49 была невыполнима
// по праву доступа, а не по офлайну: `grep warehouse.write src/` находил
// только объявление права и тест, который проверяет, что оно в списке.
//
// Решение одно на все операции склада, потому что право, проверенное в двух
// местах, расходится — и расходится в сторону «да».

import { prisma } from "@/lib/prisma";
import { can, readEmployee, type EmployeeWithRole } from "@/lib/staff/staff-service";

export class StockAccessError extends Error {}

export interface StockActor {
  operatorId: string;
  userId: string;
  isOwner: boolean;
  /** Null для владельца: у него нет строки сотрудника. */
  employee: EmployeeWithRole | null;
}

export interface StockActorOptions {
  /** Область §47: инженеру, которому выдали два пункта, третий не свой. */
  pointId?: string | null;
}

export async function requireStockActor(
  operatorId: string,
  userId: string,
  options: StockActorOptions = {},
): Promise<StockActor> {
  const operator = await prisma.chargerOperator.findUnique({
    where: { id: operatorId },
    select: { id: true, claimedById: true },
  });
  if (!operator) throw new StockAccessError("No such network");

  if (operator.claimedById && operator.claimedById === userId) {
    return { operatorId, userId, isOwner: true, employee: null };
  }

  const employee = await readEmployee(operatorId, userId);
  if (!employee || !can(employee, "warehouse.write", options.pointId ?? undefined)) {
    throw new StockAccessError("You have no business with this network's stores");
  }
  return { operatorId, userId, isOwner: false, employee };
}
